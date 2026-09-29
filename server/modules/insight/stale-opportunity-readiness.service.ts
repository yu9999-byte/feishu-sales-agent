import { Inject, Injectable } from '@nestjs/common';

import type {
  StaleOpportunityReadinessBlocker,
  StaleOpportunityReadinessItem,
  StaleOpportunityReadinessResponse,
} from '@shared/api.interface';
import {
  SALES_RECORDS_GATEWAY,
} from '@server/modules/agent-core/agent.ports';
import type {
  StaleOpportunityFollowupPage,
  StaleOpportunityFollowupRecord,
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
}

interface PageResult<T> {
  items: T[];
  warning?: string;
}

const MAX_READ_PAGES: number = 1_000;

@Injectable()
class StaleOpportunityReadinessService {
  constructor(
    @Inject(SALES_RECORDS_GATEWAY)
    private readonly records: StaleOpportunityReadinessReader,
    private readonly context: StaleOpportunityContextService =
      new StaleOpportunityContextService(),
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
        if (followup === undefined) {
          blockers.push('followup_time_missing');
        }
        return {
          recordId: opportunity.recordId,
          name: opportunity.name,
          status: opportunity.status,
          lastEffectiveFollowupAt: followup?.lastEffectiveFollowupAt ?? null,
          followupRecordId: followup?.followupRecordId ?? null,
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

export { StaleOpportunityReadinessService };
export type {
  StaleOpportunityReadinessInput,
  StaleOpportunityReadinessReader,
};
