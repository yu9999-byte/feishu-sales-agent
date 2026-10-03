import { randomUUID } from 'node:crypto';

import { Inject, Injectable, Optional } from '@nestjs/common';

import type {
  PlatformApiErrorCode,
  StaleOpportunityGovernanceRequest,
  StaleOpportunityGovernanceResponse,
  StaleOpportunityReadinessBlocker,
  StaleOpportunityReadinessItem,
  StaleOpportunityReadinessResponse,
} from '@shared/api.interface';
import {
  CONTROL_STORE,
  SALES_RECORDS_GATEWAY,
  type ControlStore,
} from '@server/modules/agent-core/agent.ports';
import type {
  StaleOpportunityFollowupPage,
  StaleOpportunityFollowupRecord,
  StaleOpportunityFollowupUpdateInput,
  StaleOpportunityPage,
  StaleOpportunityRecord,
  TenantIntegration,
} from '@server/modules/agent-core/agent.types';
import {
  StaleOpportunityContextService,
  type LatestOpportunityFollowup,
} from './stale-opportunity-context.service';

interface StaleOpportunityReadinessInput {
  integration: TenantIntegration;
  actorOpenId: string;
  now?: Date;
}

interface StaleOpportunityReadinessReader {
  readStaleOpportunityPage?(
    integration: TenantIntegration,
    actorOpenId: string,
    pageToken?: string,
  ): Promise<StaleOpportunityPage>;
  readStaleOpportunityFollowupPage?(
    integration: TenantIntegration,
    actorOpenId: string,
    pageToken?: string,
  ): Promise<StaleOpportunityFollowupPage>;
  readStaleOpportunity?(
    integration: TenantIntegration,
    actorOpenId: string,
    recordId: string,
  ): Promise<StaleOpportunityRecord>;
  readStaleOpportunityFollowup?(
    integration: TenantIntegration,
    actorOpenId: string,
    opportunityRecordId: string,
    followupRecordId: string,
  ): Promise<StaleOpportunityFollowupRecord>;
  updateOpportunityStatus?(
    integration: TenantIntegration,
    actorOpenId: string,
    input: {
      recordId: string;
      status: Exclude<StaleOpportunityGovernanceRequest['status'], 'unknown'>;
      expectedStatus: StaleOpportunityGovernanceRequest['expectedStatus'];
    },
    idempotencyKey: string,
  ): Promise<{
    previousStatus: StaleOpportunityGovernanceRequest['expectedStatus'];
    status: StaleOpportunityGovernanceRequest['status'];
  }>;
  updateStaleOpportunityFollowupCommunicationAt?(
    integration: TenantIntegration,
    actorOpenId: string,
    input: StaleOpportunityFollowupUpdateInput,
    idempotencyKey: string,
  ): Promise<{
    communicationAt: string;
    sourceVersion: string | null;
    recordUrl: string | null;
  }>;
}

interface PageResult<T> {
  items: T[];
  warning?: string;
}

const MAX_READ_PAGES: number = 1_000;

class StaleOpportunityGovernanceError extends Error {
  readonly code: PlatformApiErrorCode;
  readonly traceId: string;
  readonly retryable: boolean;

  constructor(
    code: PlatformApiErrorCode,
    message: string,
    traceId: string,
    retryable: boolean = false,
  ) {
    super(message);
    this.name = 'StaleOpportunityGovernanceError';
    this.code = code;
    this.traceId = traceId;
    this.retryable = retryable;
  }
}

@Injectable()
class StaleOpportunityReadinessService {
  constructor(
    @Inject(SALES_RECORDS_GATEWAY)
    private readonly records: StaleOpportunityReadinessReader,
    private readonly context: StaleOpportunityContextService =
      new StaleOpportunityContextService(),
    @Optional()
    @Inject(CONTROL_STORE)
    private readonly controlStore?: ControlStore,
  ) {}

  async generate(
    input: StaleOpportunityReadinessInput,
  ): Promise<StaleOpportunityReadinessResponse> {
    const generatedAt: string = (input.now ?? new Date()).toISOString();
    if (input.integration.status !== 'active') {
      return this.unavailable(generatedAt, ['销售数据连接未启用']);
    }
    if (!input.actorOpenId.trim()) {
      return this.unavailable(generatedAt, ['当前销售身份不可用']);
    }
    if (
      !this.records.readStaleOpportunityPage ||
      !this.records.readStaleOpportunityFollowupPage
    ) {
      return this.unavailable(generatedAt, ['商机治理读取端口未配置']);
    }

    let opportunityRead: PageResult<StaleOpportunityRecord>;
    let followupRead: PageResult<StaleOpportunityFollowupRecord>;
    try {
      opportunityRead = await this.readAllOpportunities(input);
      followupRead = await this.readAllFollowups(input);
    } catch (_error: unknown) {
      return this.unavailable(generatedAt, ['历史商机或跟进暂时不可读取']);
    }
    if (opportunityRead.warning || followupRead.warning) {
      return {
        generatedAt,
        status: 'incomplete',
        summary: this.emptySummary(),
        items: [],
        warnings: [
          opportunityRead.warning,
          followupRead.warning,
        ].filter((warning: string | undefined): warning is string =>
          warning !== undefined,
        ),
      };
    }

    const latest: LatestOpportunityFollowup[] = this.context.summarize(
      followupRead.items,
    );
    const latestByOpportunity: Map<string, LatestOpportunityFollowup> =
      new Map(latest.map(
        (item: LatestOpportunityFollowup): [string, LatestOpportunityFollowup] =>
          [item.opportunityRecordId, item],
      ));
    const items: StaleOpportunityReadinessItem[] = opportunityRead.items.map(
      (opportunity: StaleOpportunityRecord): StaleOpportunityReadinessItem => {
        const followup: LatestOpportunityFollowup | undefined =
          latestByOpportunity.get(opportunity.recordId);
        const blockers: StaleOpportunityReadinessBlocker[] = [];
        if (opportunity.status === 'unknown') {
          blockers.push('status_unconfirmed');
        }
        if (followup === undefined || !followup.timeVerified) {
          blockers.push('followup_time_missing');
        }
        return {
          recordId: opportunity.recordId,
          name: opportunity.name,
          status: opportunity.status,
          sourceVersion: opportunity.sourceVersion,
          lastEffectiveFollowupAt: followup?.timeVerified === true
            ? followup.lastEffectiveFollowupAt
            : null,
          followupRecordId: followup?.followupRecordId ?? null,
          followupSourceVersion: followup?.followupVersion ?? null,
          blockers,
          recordUrl: opportunity.recordUrl,
        };
      },
    );

    const summary: StaleOpportunityReadinessResponse['summary'] = {
      opportunityCount: items.length,
      statusConfirmedCount: items.filter(
        (item: StaleOpportunityReadinessItem): boolean =>
          item.status !== 'unknown',
      ).length,
      statusNeedsConfirmationCount: items.filter(
        (item: StaleOpportunityReadinessItem): boolean =>
          item.blockers.includes('status_unconfirmed'),
      ).length,
      followupTimeConfirmedCount: items.filter(
        (item: StaleOpportunityReadinessItem): boolean =>
          item.lastEffectiveFollowupAt !== null,
      ).length,
      followupTimeNeedsConfirmationCount: items.filter(
        (item: StaleOpportunityReadinessItem): boolean =>
          item.blockers.includes('followup_time_missing'),
      ).length,
      readyForScanCount: items.filter(
        (item: StaleOpportunityReadinessItem): boolean =>
          item.blockers.length === 0,
      ).length,
    };
    return {
      generatedAt,
      status: 'ready',
      summary,
      items,
      warnings: [],
    };
  }

  async govern(
    input: {
      integration: TenantIntegration;
      actorOpenId: string;
      request: StaleOpportunityGovernanceRequest;
    },
  ): Promise<StaleOpportunityGovernanceResponse> {
    const traceId: string = randomUUID();
    const request: StaleOpportunityGovernanceRequest = input.request;
    try {
      this.validateGovernanceInput(input, traceId);
      if (
        !this.records.readStaleOpportunity ||
        !this.records.updateOpportunityStatus
      ) {
        throw new StaleOpportunityGovernanceError(
          'DEPENDENCY_UNAVAILABLE',
          '商机治理写入端口未配置',
          traceId,
          true,
        );
      }
      const opportunity: StaleOpportunityRecord =
        await this.records.readStaleOpportunity(
          input.integration,
          input.actorOpenId,
          request.recordId,
        );
      if (
        opportunity.sourceVersion === null ||
        request.expectedSourceVersion === null
      ) {
        throw new StaleOpportunityGovernanceError(
          'VALIDATION_FAILED',
          '商机版本不可用，无法安全确认',
          traceId,
        );
      }
      if (opportunity.sourceVersion !== request.expectedSourceVersion) {
        throw new StaleOpportunityGovernanceError(
          'CONFLICT',
          '商机记录已变化，请刷新后再确认',
          traceId,
        );
      }
      if (opportunity.status !== request.expectedStatus) {
        throw new StaleOpportunityGovernanceError(
          'CONFLICT',
          '商机状态已变化，请刷新后再确认',
          traceId,
        );
      }

      let followup: StaleOpportunityFollowupRecord | null = null;
      if (request.followupRecordId !== null) {
        if (!this.records.readStaleOpportunityFollowup) {
          throw new StaleOpportunityGovernanceError(
            'DEPENDENCY_UNAVAILABLE',
            '跟进治理读取端口未配置',
            traceId,
            true,
          );
        }
        followup = await this.records.readStaleOpportunityFollowup(
          input.integration,
          input.actorOpenId,
          request.recordId,
          request.followupRecordId,
        );
        if (
          followup.sourceVersion === null ||
          request.expectedFollowupSourceVersion === null
        ) {
          throw new StaleOpportunityGovernanceError(
            'VALIDATION_FAILED',
            '跟进版本不可用，无法安全确认',
            traceId,
          );
        }
        if (followup.sourceVersion !== request.expectedFollowupSourceVersion) {
          throw new StaleOpportunityGovernanceError(
            'CONFLICT',
            '跟进记录已变化，请刷新后再确认',
            traceId,
          );
        }
      } else if (request.expectedFollowupSourceVersion !== null) {
        throw new StaleOpportunityGovernanceError(
          'VALIDATION_FAILED',
          '跟进版本与记录不一致，无法确认',
          traceId,
        );
      }
      if (
        request.communicationAt !== undefined &&
        request.communicationAt !== null &&
        (followup === null ||
          !this.records.updateStaleOpportunityFollowupCommunicationAt)
      ) {
        throw new StaleOpportunityGovernanceError(
          'VALIDATION_FAILED',
          '没有可更新的已有跟进记录，不能伪造历史跟进',
          traceId,
        );
      }

      await this.audit({
        tenantId: input.integration.tenantId,
        traceId,
        eventType: 'stale_opportunity_governance',
        actorOpenId: input.actorOpenId,
        entityId: request.recordId,
        outcome: 'accepted',
        details: {
          status: request.status,
          expectedStatus: request.expectedStatus,
          followupRecordId: request.followupRecordId,
          communicationAt: request.communicationAt ?? null,
        },
      });

      let previousStatus: StaleOpportunityGovernanceRequest['expectedStatus'] =
        opportunity.status;
      if (opportunity.status !== request.status) {
        const statusResult = await this.records.updateOpportunityStatus(
          input.integration,
          input.actorOpenId,
          {
            recordId: request.recordId,
            status: request.status,
            expectedStatus: request.expectedStatus,
          },
          `${request.idempotencyKey}:status`,
        );
        previousStatus = statusResult.previousStatus;
      }

      if (request.communicationAt !== undefined &&
          request.communicationAt !== null) {
        if (followup === null ||
            !this.records.updateStaleOpportunityFollowupCommunicationAt) {
          throw new StaleOpportunityGovernanceError(
            'VALIDATION_FAILED',
            '没有可更新的已有跟进记录，不能伪造历史跟进',
            traceId,
          );
        }
        const updatedFollowup =
          await this.records.updateStaleOpportunityFollowupCommunicationAt(
            input.integration,
            input.actorOpenId,
            {
              recordId: followup.recordId,
              opportunityRecordId: request.recordId,
              communicationAt: request.communicationAt,
              expectedSourceVersion: request.expectedFollowupSourceVersion,
            },
            `${request.idempotencyKey}:followup`,
          );
        followup = {
          ...followup,
          communicationAt: updatedFollowup.communicationAt,
          sourceVersion: updatedFollowup.sourceVersion,
          recordUrl: updatedFollowup.recordUrl,
        };
      }

      const verifiedOpportunity: StaleOpportunityRecord =
        await this.records.readStaleOpportunity(
          input.integration,
          input.actorOpenId,
          request.recordId,
        );
      const response: StaleOpportunityGovernanceResponse = {
        traceId,
        recordId: request.recordId,
        previousStatus,
        status: verifiedOpportunity.status === 'unknown'
          ? request.status
          : verifiedOpportunity.status,
        followupRecordId: followup?.recordId ?? null,
        communicationAt: followup?.communicationAt ?? null,
        sourceVersion: verifiedOpportunity.sourceVersion,
        followupSourceVersion: followup?.sourceVersion ?? null,
      };
      await this.audit({
        tenantId: input.integration.tenantId,
        traceId,
        eventType: 'stale_opportunity_governance',
        actorOpenId: input.actorOpenId,
        entityId: request.recordId,
        outcome: 'succeeded',
        details: {
          status: response.status,
          followupRecordId: response.followupRecordId,
          communicationAt: response.communicationAt,
        },
      });
      return response;
    } catch (error: unknown) {
      const normalized: StaleOpportunityGovernanceError =
        this.normalizeGovernanceError(error, traceId);
      await this.audit({
        tenantId: input.integration.tenantId,
        traceId,
        eventType: 'stale_opportunity_governance',
        actorOpenId: input.actorOpenId,
        entityId: request.recordId,
        outcome: 'failed',
        details: { code: normalized.code, message: normalized.message },
      });
      throw normalized;
    }
  }

  private validateGovernanceInput(
    input: {
      integration: TenantIntegration;
      actorOpenId: string;
      request: StaleOpportunityGovernanceRequest;
    },
    traceId: string,
  ): void {
    const request: StaleOpportunityGovernanceRequest = input.request;
    const statusValues: string[] = ['active', 'won', 'lost', 'closed'];
    if (input.integration.status !== 'active' || !input.actorOpenId.trim()) {
      throw new StaleOpportunityGovernanceError(
        'DEPENDENCY_UNAVAILABLE',
        '销售数据源暂时不可用',
        traceId,
        true,
      );
    }
    if (
      !request.recordId.trim() ||
      !statusValues.includes(request.status) ||
      !statusValues.concat('unknown').includes(request.expectedStatus) ||
      !request.idempotencyKey.trim()
    ) {
      throw new StaleOpportunityGovernanceError(
        'VALIDATION_FAILED',
        '商机确认参数不完整',
        traceId,
      );
    }
    if (
      request.communicationAt !== undefined &&
      request.communicationAt !== null &&
      !Number.isFinite(Date.parse(request.communicationAt))
    ) {
      throw new StaleOpportunityGovernanceError(
        'VALIDATION_FAILED',
        '可信沟通时间格式无效',
        traceId,
      );
    }
  }

  private normalizeGovernanceError(
    error: unknown,
    traceId: string,
  ): StaleOpportunityGovernanceError {
    if (error instanceof StaleOpportunityGovernanceError) return error;
    const message: string =
      error instanceof Error ? error.message : '商机治理失败';
    if (message.includes('not owned')) {
      return new StaleOpportunityGovernanceError(
        'ACCESS_DENIED',
        '只能确认本人负责的商机',
        traceId,
      );
    }
    if (message.includes('changed after confirmation')) {
      return new StaleOpportunityGovernanceError(
        'CONFLICT',
        '记录已变化，请刷新后再确认',
        traceId,
      );
    }
    if (message.includes('could not be verified')) {
      return new StaleOpportunityGovernanceError(
        'INTERNAL_ERROR',
        '写入后校验失败，请查看追踪号并稍后重试',
        traceId,
      );
    }
    return new StaleOpportunityGovernanceError(
      'DEPENDENCY_UNAVAILABLE',
      '销售数据源暂时不可用，未能完成确认',
      traceId,
      true,
    );
  }

  private async audit(
    event: Parameters<ControlStore['appendAudit']>[0],
  ): Promise<void> {
    if (!this.controlStore) return;
    try {
      await this.controlStore.appendAudit(event);
    } catch (_error: unknown) {
      // Audit failures must not hide the business result.
    }
  }

  private async readAllOpportunities(
    input: StaleOpportunityReadinessInput,
  ): Promise<PageResult<StaleOpportunityRecord>> {
    const items: StaleOpportunityRecord[] = [];
    const seenTokens: Set<string> = new Set();
    let pageToken: string | undefined;
    for (let page: number = 0; page < MAX_READ_PAGES; page += 1) {
      const result: StaleOpportunityPage =
        await this.records.readStaleOpportunityPage!(
          input.integration,
          input.actorOpenId,
          pageToken,
        );
      items.push(...result.items);
      if (result.warning) return { items, warning: result.warning };
      if (!result.nextPageToken) return { items };
      if (seenTokens.has(result.nextPageToken)) {
        return { items, warning: '商机分页游标重复，无法确认全量数据' };
      }
      seenTokens.add(result.nextPageToken);
      pageToken = result.nextPageToken;
    }
    return { items, warning: '商机分页超过安全上限，无法确认全量数据' };
  }

  private async readAllFollowups(
    input: StaleOpportunityReadinessInput,
  ): Promise<PageResult<StaleOpportunityFollowupRecord>> {
    const items: StaleOpportunityFollowupRecord[] = [];
    const seenTokens: Set<string> = new Set();
    let pageToken: string | undefined;
    for (let page: number = 0; page < MAX_READ_PAGES; page += 1) {
      const result: StaleOpportunityFollowupPage =
        await this.records.readStaleOpportunityFollowupPage!(
          input.integration,
          input.actorOpenId,
          pageToken,
        );
      items.push(...result.items);
      if (result.warning) return { items, warning: result.warning };
      if (!result.nextPageToken) return { items };
      if (seenTokens.has(result.nextPageToken)) {
        return { items, warning: '跟进分页游标重复，无法确认全量数据' };
      }
      seenTokens.add(result.nextPageToken);
      pageToken = result.nextPageToken;
    }
    return { items, warning: '跟进分页超过安全上限，无法确认全量数据' };
  }

  private emptySummary(): StaleOpportunityReadinessResponse['summary'] {
    return {
      opportunityCount: 0,
      statusConfirmedCount: 0,
      statusNeedsConfirmationCount: 0,
      followupTimeConfirmedCount: 0,
      followupTimeNeedsConfirmationCount: 0,
      readyForScanCount: 0,
    };
  }

  private unavailable(
    generatedAt: string,
    warnings: string[],
  ): StaleOpportunityReadinessResponse {
    return {
      generatedAt,
      status: 'unavailable',
      summary: this.emptySummary(),
      items: [],
      warnings,
    };
  }
}

export {
  StaleOpportunityGovernanceError,
  StaleOpportunityReadinessService,
};
export type {
  StaleOpportunityReadinessInput,
  StaleOpportunityReadinessReader,
};
