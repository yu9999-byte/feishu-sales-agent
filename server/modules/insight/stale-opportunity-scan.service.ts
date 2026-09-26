import type {
  SalesContextTaskResult,
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
import {
  StaleOpportunityDecisionService,
  type StaleOpportunityDecision,
  type StaleOpportunityEvidence,
  type StaleOpportunityReason,
} from './stale-opportunity-decision.service';

interface StaleOpportunityRecordsReader {
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

interface StaleOpportunityTaskReader {
  searchOwnedTasks?(
    integration: TenantIntegration,
    actorOpenId: string,
    query: string,
  ): Promise<SalesContextTaskResult>;
}

interface StaleOpportunityScanInput {
  enabled?: boolean;
  integration: TenantIntegration;
  actorOpenId: string;
  timezone: string;
  now?: Date;
}

type StaleOpportunityScanStatus = 'disabled' | 'complete' | 'incomplete';
type StaleOpportunityScanSkipReason =
  | StaleOpportunityReason
  | 'integration_disabled'
  | 'source_unverified';

interface StaleOpportunityScanSkip {
  opportunityRecordId: string | null;
  opportunityName: string | null;
  reason: StaleOpportunityScanSkipReason;
}

interface StaleOpportunityScanResult {
  status: StaleOpportunityScanStatus;
  candidates: StaleOpportunityEvidence[];
  skips: StaleOpportunityScanSkip[];
  warnings: string[];
}

interface OpportunityPageReadResult {
  items: StaleOpportunityRecord[];
  warning?: string;
}

interface FollowupPageReadResult {
  items: StaleOpportunityFollowupRecord[];
  warning?: string;
}

const MAX_SCAN_PAGES = 1_000;

class StaleOpportunityScanService {
  constructor(
    private readonly records: StaleOpportunityRecordsReader,
    private readonly tasks: StaleOpportunityTaskReader,
    private readonly context: StaleOpportunityContextService =
      new StaleOpportunityContextService(),
    private readonly decisions: StaleOpportunityDecisionService =
      new StaleOpportunityDecisionService(),
  ) {}

  async scan(
    input: StaleOpportunityScanInput,
  ): Promise<StaleOpportunityScanResult> {
    if (input.enabled !== true) {
      return {
        status: 'disabled',
        candidates: [],
        skips: [{
          opportunityRecordId: null,
          opportunityName: null,
          reason: 'disabled',
        }],
        warnings: [],
      };
    }
    if (input.integration.status !== 'active') {
      return {
        status: 'disabled',
        candidates: [],
        skips: [{
          opportunityRecordId: null,
          opportunityName: null,
          reason: 'integration_disabled',
        }],
        warnings: [],
      };
    }
    if (!input.actorOpenId.trim()) {
      return this.sourceFailure('stale_opportunity_actor_not_configured');
    }
    if (!this.records.readStaleOpportunityPage) {
      return this.sourceFailure('stale_opportunity_reader_not_configured');
    }
    if (!this.records.readStaleOpportunityFollowupPage) {
      return this.sourceFailure('stale_followup_reader_not_configured');
    }

    let opportunityRead: OpportunityPageReadResult;
    try {
      opportunityRead = await this.readAllOpportunities(input);
    } catch (_error: unknown) {
      return this.sourceFailure('stale_opportunity_read_unavailable');
    }
    if (opportunityRead.warning) {
      return this.sourceFailure(opportunityRead.warning);
    }

    let followupRead: FollowupPageReadResult;
    try {
      followupRead = await this.readAllFollowups(input);
    } catch (_error: unknown) {
      return this.sourceFailure('stale_followup_read_unavailable');
    }
    if (followupRead.warning) {
      return this.sourceFailure(followupRead.warning);
    }

    const latest: LatestOpportunityFollowup[] =
      this.context.summarize(followupRead.items);
    const latestByOpportunity: Map<string, LatestOpportunityFollowup> =
      new Map(latest.map(
        (item: LatestOpportunityFollowup): [string, LatestOpportunityFollowup] =>
          [item.opportunityRecordId, item],
      ));
    const candidates: StaleOpportunityEvidence[] = [];
    const skips: StaleOpportunityScanSkip[] = [];
    const now: Date = input.now ?? new Date();

    for (const opportunity of opportunityRead.items) {
      const lastFollowup: LatestOpportunityFollowup | undefined =
        latestByOpportunity.get(opportunity.recordId);
      const baseDecision: StaleOpportunityDecision = this.decisions.decide({
        enabled: true,
        tenantId: input.integration.tenantId,
        timezone: input.timezone,
        opportunityRecordId: opportunity.recordId,
        opportunityName: opportunity.name,
        opportunityStatus: opportunity.status,
        ownerOpenId: opportunity.ownerOpenId,
        recipientOpenId: input.actorOpenId,
        lastFollowup: lastFollowup
          ? {
              recordId: lastFollowup.followupRecordId,
              occurredAt: lastFollowup.lastEffectiveFollowupAt,
              version: lastFollowup.followupVersion,
            }
          : null,
        taskReadStatus: 'complete',
        hasRelevantOpenTask: false,
        now,
      });
      if (baseDecision.status !== 'eligible') {
        skips.push(this.toSkip(opportunity, baseDecision));
        continue;
      }
      if (!this.tasks.searchOwnedTasks) {
        return this.sourceFailure(
          'stale_opportunity_task_reader_not_configured',
          skips,
        );
      }

      let taskResult: SalesContextTaskResult;
      try {
        taskResult = await this.tasks.searchOwnedTasks(
          input.integration,
          input.actorOpenId,
          opportunity.name,
        );
      } catch (_error: unknown) {
        return this.sourceFailure(
          'stale_opportunity_task_read_unavailable',
          skips,
        );
      }
      if (taskResult.warning) {
        return this.sourceFailure(taskResult.warning, skips);
      }

      const finalDecision: StaleOpportunityDecision = this.decisions.decide({
        enabled: true,
        tenantId: input.integration.tenantId,
        timezone: input.timezone,
        opportunityRecordId: opportunity.recordId,
        opportunityName: opportunity.name,
        opportunityStatus: opportunity.status,
        ownerOpenId: opportunity.ownerOpenId,
        recipientOpenId: input.actorOpenId,
        lastFollowup: lastFollowup
          ? {
              recordId: lastFollowup.followupRecordId,
              occurredAt: lastFollowup.lastEffectiveFollowupAt,
              version: lastFollowup.followupVersion,
            }
          : null,
        taskReadStatus: 'complete',
        hasRelevantOpenTask: taskResult.items.length > 0,
        now,
      });
      if (finalDecision.status === 'eligible' && finalDecision.evidence) {
        candidates.push(finalDecision.evidence);
      } else {
        skips.push(this.toSkip(opportunity, finalDecision));
      }
    }

    return { status: 'complete', candidates, skips, warnings: [] };
  }

  private async readAllOpportunities(
    input: StaleOpportunityScanInput,
  ): Promise<OpportunityPageReadResult> {
    const items: StaleOpportunityRecord[] = [];
    const seenTokens: Set<string> = new Set();
    let pageToken: string | undefined;
    for (let page: number = 0; page < MAX_SCAN_PAGES; page += 1) {
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
        return { items, warning: 'stale_opportunity_pagination_cycle' };
      }
      seenTokens.add(result.nextPageToken);
      pageToken = result.nextPageToken;
    }
    return { items, warning: 'stale_opportunity_pagination_limited' };
  }

  private async readAllFollowups(
    input: StaleOpportunityScanInput,
  ): Promise<FollowupPageReadResult> {
    const items: StaleOpportunityFollowupRecord[] = [];
    const seenTokens: Set<string> = new Set();
    let pageToken: string | undefined;
    for (let page: number = 0; page < MAX_SCAN_PAGES; page += 1) {
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
        return { items, warning: 'stale_followup_pagination_cycle' };
      }
      seenTokens.add(result.nextPageToken);
      pageToken = result.nextPageToken;
    }
    return { items, warning: 'stale_followup_pagination_limited' };
  }

  private sourceFailure(
    warning: string,
    priorSkips: StaleOpportunityScanSkip[] = [],
  ): StaleOpportunityScanResult {
    return {
      status: 'incomplete',
      candidates: [],
      skips: [
        ...priorSkips,
        {
          opportunityRecordId: null,
          opportunityName: null,
          reason: 'source_unverified',
        },
      ],
      warnings: [warning],
    };
  }

  private toSkip(
    opportunity: StaleOpportunityRecord,
    decision: StaleOpportunityDecision,
  ): StaleOpportunityScanSkip {
    return {
      opportunityRecordId: opportunity.recordId,
      opportunityName: opportunity.name,
      reason: decision.reason,
    };
  }
}

export { StaleOpportunityScanService };
export type {
  StaleOpportunityRecordsReader,
  StaleOpportunityScanInput,
  StaleOpportunityScanResult,
  StaleOpportunityScanSkip,
  StaleOpportunityScanSkipReason,
  StaleOpportunityScanStatus,
  StaleOpportunityTaskReader,
};
