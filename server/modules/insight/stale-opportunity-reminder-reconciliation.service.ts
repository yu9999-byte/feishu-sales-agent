import { Inject, Injectable, Optional } from '@nestjs/common';

import type {
  StaleOpportunityReminderReconciliationDecision,
  StaleOpportunityReminderReconciliationListResponse,
  StaleOpportunityReminderReconciliationResponse,
} from '@shared/api.interface';
import type {
  StaleOpportunityReminderReconciler,
  StaleOpportunityReminderUncertainReader,
  StaleOpportunityReminderUncertainRecord,
} from './stale-opportunity-reminder.service';
import {
  STALE_OPPORTUNITY_REMINDER_UNCERTAIN_READER,
} from './stale-opportunity-reminder-runtime.service';

interface StaleOpportunityReminderReconciliationInput {
  tenantId?: string;
  limit?: number;
}

type StaleOpportunityReminderReconciliationResult =
  StaleOpportunityReminderReconciliationListResponse;

interface StaleOpportunityReminderReconciliationCommandInput {
  tenantId: string;
  operatorMemberId: string;
  opportunityRecordId: string;
  followupVersion: string;
  reminderKind: 'stale_followup';
  expectedUpdatedAt: string;
  decision: StaleOpportunityReminderReconciliationDecision;
  note: string;
  messageId?: string;
  sentAt?: string;
  now?: Date;
}

type StaleOpportunityReminderReconciliationErrorCode =
  | 'VALIDATION_FAILED'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'DEPENDENCY_UNAVAILABLE';

const DEFAULT_LIMIT: number = 50;
const MAX_LIMIT: number = 100;
const MAX_KEY_LENGTH: number = 255;
const MAX_NOTE_LENGTH: number = 2_000;
const MIN_NOTE_LENGTH: number = 5;
const VALID_DECISIONS: StaleOpportunityReminderReconciliationDecision[] = [
  'confirm_sent',
  'authorize_retry',
  'keep_frozen',
];
const OFFSET_DATE_TIME: RegExp =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/u;
const STALE_OPPORTUNITY_REMINDER_RECONCILER = Symbol(
  'STALE_OPPORTUNITY_REMINDER_RECONCILER',
);

class StaleOpportunityReminderReconciliationError extends Error {
  constructor(
    readonly code: StaleOpportunityReminderReconciliationErrorCode,
    message: string,
    readonly currentStatus?: string,
    readonly currentUpdatedAt?: string,
  ) {
    super(message);
    this.name = 'StaleOpportunityReminderReconciliationError';
  }
}

@Injectable()
class StaleOpportunityReminderReconciliationService {
  constructor(
    @Inject(STALE_OPPORTUNITY_REMINDER_UNCERTAIN_READER)
    private readonly reader: StaleOpportunityReminderUncertainReader,
    @Optional()
    @Inject(STALE_OPPORTUNITY_REMINDER_RECONCILER)
    private readonly reconciler?: StaleOpportunityReminderReconciler,
  ) {}

  async listUncertain(
    input: StaleOpportunityReminderReconciliationInput = {},
  ): Promise<StaleOpportunityReminderReconciliationResult> {
    const limit: number = input.limit ?? DEFAULT_LIMIT;
    if (
      !Number.isInteger(limit) ||
      limit < 1 ||
      limit > MAX_LIMIT
    ) {
      return {
        status: 'unavailable',
        items: [],
        warnings: ['reconciliation_limit_invalid'],
      };
    }
    if (input.tenantId !== undefined && !input.tenantId.trim()) {
      return {
        status: 'unavailable',
        items: [],
        warnings: ['reconciliation_tenant_invalid'],
      };
    }
    try {
      const items: StaleOpportunityReminderUncertainRecord[] =
        await this.reader.listUncertain({
          tenantId: input.tenantId,
          limit,
        });
      return { status: 'ready', items, warnings: [] };
    } catch (_error: unknown) {
      return {
        status: 'unavailable',
        items: [],
        warnings: ['reconciliation_source_unavailable'],
      };
    }
  }

  async reconcile(
    input: StaleOpportunityReminderReconciliationCommandInput,
  ): Promise<StaleOpportunityReminderReconciliationResponse> {
    const normalized = this.validateCommand(input);
    if (!this.reconciler) {
      throw new StaleOpportunityReminderReconciliationError(
        'DEPENDENCY_UNAVAILABLE',
        '提醒对账写入服务暂时不可用',
      );
    }
    try {
      const result = await this.reconciler.reconcile(normalized);
      if (result.status === 'not_found') {
        throw new StaleOpportunityReminderReconciliationError(
          'NOT_FOUND',
          '未找到当前企业内对应的提醒记录',
        );
      }
      if (result.status === 'conflict') {
        throw new StaleOpportunityReminderReconciliationError(
          'CONFLICT',
          '提醒记录已变化，请刷新后重新核对',
          result.currentStatus,
          result.currentUpdatedAt.toISOString(),
        );
      }
      return {
        reconciliationId: result.reconciliationId,
        opportunityRecordId: normalized.opportunityRecordId,
        followupVersion: normalized.followupVersion,
        reminderKind: normalized.reminderKind,
        decision: normalized.decision,
        previousStatus: result.previousStatus,
        currentStatus: result.currentStatus,
        updatedAt: result.updatedAt.toISOString(),
      };
    } catch (error: unknown) {
      if (error instanceof StaleOpportunityReminderReconciliationError) {
        throw error;
      }
      throw new StaleOpportunityReminderReconciliationError(
        'DEPENDENCY_UNAVAILABLE',
        '提醒对账暂时不可用，账本未修改',
      );
    }
  }

  private validateCommand(
    input: StaleOpportunityReminderReconciliationCommandInput,
  ) {
    const now: Date = input.now ?? new Date();
    const tenantId: string = input.tenantId.trim();
    const operatorMemberId: string = input.operatorMemberId.trim();
    const opportunityRecordId: string = input.opportunityRecordId.trim();
    const followupVersion: string = input.followupVersion.trim();
    const note: string = input.note.trim();
    const expectedUpdatedAt: Date = new Date(input.expectedUpdatedAt);
    const sentAt: Date | undefined = input.sentAt === undefined
      ? undefined
      : new Date(input.sentAt);
    const hasValidCommonFields: boolean = Boolean(
      tenantId &&
      operatorMemberId &&
      opportunityRecordId &&
      opportunityRecordId.length <= MAX_KEY_LENGTH &&
      followupVersion &&
      followupVersion.length <= MAX_KEY_LENGTH &&
      input.reminderKind === 'stale_followup' &&
      VALID_DECISIONS.includes(input.decision) &&
      OFFSET_DATE_TIME.test(input.expectedUpdatedAt) &&
      Number.isFinite(expectedUpdatedAt.getTime()) &&
      Number.isFinite(now.getTime()) &&
      expectedUpdatedAt.getTime() <= now.getTime() &&
      note.length >= MIN_NOTE_LENGTH &&
      note.length <= MAX_NOTE_LENGTH
    );
    if (!hasValidCommonFields) {
      throw new StaleOpportunityReminderReconciliationError(
        'VALIDATION_FAILED',
        '提醒对账参数不完整或格式无效',
      );
    }
    const messageId: string | undefined = input.messageId?.trim();
    if (input.decision === 'confirm_sent') {
      if (
        !messageId ||
        messageId.length > MAX_KEY_LENGTH ||
        input.sentAt === undefined ||
        !OFFSET_DATE_TIME.test(input.sentAt) ||
        sentAt === undefined ||
        !Number.isFinite(sentAt.getTime()) ||
        sentAt.getTime() > now.getTime()
      ) {
        throw new StaleOpportunityReminderReconciliationError(
          'VALIDATION_FAILED',
          '确认已发送时必须提供有效消息 ID 和实际发送时间',
        );
      }
    } else if (messageId !== undefined || input.sentAt !== undefined) {
      throw new StaleOpportunityReminderReconciliationError(
        'VALIDATION_FAILED',
        '只有确认已发送时才能提交消息证据',
      );
    }
    return {
      tenantId,
      operatorMemberId,
      opportunityRecordId,
      followupVersion,
      reminderKind: input.reminderKind,
      expectedUpdatedAt,
      decision: input.decision,
      note,
      messageId,
      sentAt,
      reconciledAt: now,
    };
  }
}

export {
  STALE_OPPORTUNITY_REMINDER_RECONCILER,
  StaleOpportunityReminderReconciliationError,
  StaleOpportunityReminderReconciliationService,
};
export type {
  StaleOpportunityReminderReconciliationCommandInput,
  StaleOpportunityReminderReconciliationErrorCode,
  StaleOpportunityReminderReconciliationInput,
  StaleOpportunityReminderReconciliationResult,
};
