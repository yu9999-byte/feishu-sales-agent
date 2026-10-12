import type {
  ProactiveNotificationReconciliationDecision,
  ProactiveNotificationReconciliationItem,
  ProactiveNotificationReconciliationListResponse,
  ProactiveNotificationReconciliationResponse,
} from '@shared/api.interface';

interface ProactiveNotificationUncertainRecord
extends ProactiveNotificationReconciliationItem {
  tenantId: string;
}

interface ProactiveNotificationReconciliationListInput {
  tenantId: string;
  limit?: number;
}

interface ProactiveNotificationReconcileCommandInput {
  tenantId: string;
  operatorMemberId: string;
  notificationId: string;
  expectedUpdatedAt: string;
  decision: ProactiveNotificationReconciliationDecision;
  note: string;
  messageId?: string;
  sentAt?: string;
  now?: Date;
}

interface ProactiveNotificationReconcileInput {
  tenantId: string;
  operatorMemberId: string;
  notificationId: string;
  expectedUpdatedAt: Date;
  decision: ProactiveNotificationReconciliationDecision;
  note: string;
  messageId?: string;
  sentAt?: Date;
  reconciledAt: Date;
}

type ProactiveNotificationLedgerStatus =
  | 'claimed'
  | 'dispatching'
  | 'sent'
  | 'failed'
  | 'uncertain';

type ProactiveNotificationReconcileResult =
  | {
      status: 'reconciled';
      reconciliationId: string;
      previousStatus: 'uncertain';
      currentStatus: 'sent' | 'failed' | 'uncertain';
      updatedAt: Date;
    }
  | {
      status: 'conflict';
      currentStatus: ProactiveNotificationLedgerStatus;
      currentUpdatedAt: Date;
    }
  | { status: 'not_found' };

interface ProactiveNotificationReconciliationStore {
  listUncertain(input: {
    tenantId: string;
    limit: number;
  }): Promise<ProactiveNotificationUncertainRecord[]>;
  reconcile(
    input: ProactiveNotificationReconcileInput,
  ): Promise<ProactiveNotificationReconcileResult>;
}

type ProactiveNotificationReconciliationErrorCode =
  | 'VALIDATION_FAILED'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'DEPENDENCY_UNAVAILABLE';

const DEFAULT_LIMIT: number = 50;
const MAX_LIMIT: number = 100;
const MAX_NOTE_LENGTH: number = 2_000;
const MIN_NOTE_LENGTH: number = 5;
const MAX_MESSAGE_ID_LENGTH: number = 255;
const VALID_DECISIONS: ProactiveNotificationReconciliationDecision[] = [
  'confirm_sent',
  'authorize_retry',
  'keep_frozen',
];
const UUID: RegExp =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const OFFSET_DATE_TIME: RegExp =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/u;

class ProactiveNotificationReconciliationError extends Error {
  constructor(
    readonly code: ProactiveNotificationReconciliationErrorCode,
    message: string,
    readonly currentStatus?: string,
    readonly currentUpdatedAt?: string,
  ) {
    super(message);
    this.name = 'ProactiveNotificationReconciliationError';
  }
}

class ProactiveNotificationReconciliationService {
  constructor(
    private readonly store: ProactiveNotificationReconciliationStore,
  ) {}

  async listUncertain(
    input: ProactiveNotificationReconciliationListInput,
  ): Promise<ProactiveNotificationReconciliationListResponse> {
    const tenantId: string = input.tenantId.trim();
    const limit: number = input.limit ?? DEFAULT_LIMIT;
    if (!UUID.test(tenantId)) {
      return {
        status: 'unavailable',
        items: [],
        warnings: ['proactive_reconciliation_tenant_invalid'],
      };
    }
    if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) {
      return {
        status: 'unavailable',
        items: [],
        warnings: ['proactive_reconciliation_limit_invalid'],
      };
    }
    try {
      const records: ProactiveNotificationUncertainRecord[] =
        await this.store.listUncertain({ tenantId, limit });
      const items: ProactiveNotificationReconciliationItem[] = records.map(
        (record: ProactiveNotificationUncertainRecord):
        ProactiveNotificationReconciliationItem => ({
          notificationId: record.notificationId,
          recipientMemberId: record.recipientMemberId,
          recipientDisplayName: record.recipientDisplayName,
          kind: record.kind,
          notificationKey: record.notificationKey,
          subjectKey: record.subjectKey,
          attemptCount: record.attemptCount,
          dispatchStartedAt: record.dispatchStartedAt,
          failureCode: record.failureCode,
          failureMessage: record.failureMessage,
          updatedAt: record.updatedAt,
        }),
      );
      return { status: 'ready', items, warnings: [] };
    } catch (_error: unknown) {
      return {
        status: 'unavailable',
        items: [],
        warnings: ['proactive_reconciliation_source_unavailable'],
      };
    }
  }

  async reconcile(
    input: ProactiveNotificationReconcileCommandInput,
  ): Promise<ProactiveNotificationReconciliationResponse> {
    const normalized: ProactiveNotificationReconcileInput =
      this.validateCommand(input);
    try {
      const result: ProactiveNotificationReconcileResult =
        await this.store.reconcile(normalized);
      if (result.status === 'not_found') {
        throw new ProactiveNotificationReconciliationError(
          'NOT_FOUND',
          '未找到当前企业内对应的主动通知记录',
        );
      }
      if (result.status === 'conflict') {
        throw new ProactiveNotificationReconciliationError(
          'CONFLICT',
          '通知记录已变化，请刷新后重新核对',
          result.currentStatus,
          result.currentUpdatedAt.toISOString(),
        );
      }
      return {
        reconciliationId: result.reconciliationId,
        notificationId: normalized.notificationId,
        decision: normalized.decision,
        previousStatus: result.previousStatus,
        currentStatus: result.currentStatus,
        updatedAt: result.updatedAt.toISOString(),
      };
    } catch (error: unknown) {
      if (error instanceof ProactiveNotificationReconciliationError) {
        throw error;
      }
      throw new ProactiveNotificationReconciliationError(
        'DEPENDENCY_UNAVAILABLE',
        '主动通知对账暂时不可用，账本未修改',
      );
    }
  }

  private validateCommand(
    input: ProactiveNotificationReconcileCommandInput,
  ): ProactiveNotificationReconcileInput {
    const tenantId: string = input.tenantId.trim();
    const operatorMemberId: string = input.operatorMemberId.trim();
    const notificationId: string = input.notificationId.trim();
    const note: string = input.note.trim();
    const now: Date = input.now ?? new Date();
    const expectedUpdatedAt: Date = new Date(input.expectedUpdatedAt);
    const sentAt: Date | undefined = input.sentAt === undefined
      ? undefined
      : new Date(input.sentAt);
    const commonFieldsValid: boolean = Boolean(
      UUID.test(tenantId) &&
      UUID.test(operatorMemberId) &&
      UUID.test(notificationId) &&
      VALID_DECISIONS.includes(input.decision) &&
      OFFSET_DATE_TIME.test(input.expectedUpdatedAt) &&
      Number.isFinite(expectedUpdatedAt.getTime()) &&
      Number.isFinite(now.getTime()) &&
      expectedUpdatedAt.getTime() <= now.getTime() &&
      note.length >= MIN_NOTE_LENGTH &&
      note.length <= MAX_NOTE_LENGTH
    );
    if (!commonFieldsValid) {
      throw new ProactiveNotificationReconciliationError(
        'VALIDATION_FAILED',
        '主动通知对账参数不完整或格式无效',
      );
    }

    const messageId: string | undefined = input.messageId?.trim();
    if (input.decision === 'confirm_sent') {
      const evidenceValid: boolean = Boolean(
        messageId &&
        messageId.length <= MAX_MESSAGE_ID_LENGTH &&
        input.sentAt !== undefined &&
        OFFSET_DATE_TIME.test(input.sentAt) &&
        sentAt !== undefined &&
        Number.isFinite(sentAt.getTime()) &&
        sentAt.getTime() <= now.getTime()
      );
      if (!evidenceValid) {
        throw new ProactiveNotificationReconciliationError(
          'VALIDATION_FAILED',
          '确认已送达时必须提供有效消息 ID 和实际发送时间',
        );
      }
    } else if (messageId !== undefined || input.sentAt !== undefined) {
      throw new ProactiveNotificationReconciliationError(
        'VALIDATION_FAILED',
        '只有确认已送达时才能提交消息证据',
      );
    }

    return {
      tenantId,
      operatorMemberId,
      notificationId,
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
  ProactiveNotificationReconciliationError,
  ProactiveNotificationReconciliationService,
};
export type {
  ProactiveNotificationReconcileCommandInput,
  ProactiveNotificationReconcileInput,
  ProactiveNotificationReconcileResult,
  ProactiveNotificationReconciliationErrorCode,
  ProactiveNotificationReconciliationListInput,
  ProactiveNotificationReconciliationStore,
  ProactiveNotificationUncertainRecord,
};
