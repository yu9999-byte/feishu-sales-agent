import { Inject, Injectable } from '@nestjs/common';

import type {
  StaleOpportunityReadinessItem,
  StaleOpportunityReadinessResponse,
  StaleOpportunityReadinessSummary,
  StaleOpportunityReminderHistoryGovernanceEvidence,
} from '@shared/api.interface';
import {
  AGENT_CONFIG,
  type AgentRuntimeConfig,
} from '@server/config/agent.config';
import {
  CONTROL_STORE,
} from '@server/modules/agent-core/agent.ports';
import type {
  TenantIntegration,
} from '@server/modules/agent-core/agent.types';
import {
  IDENTITY_ACCESS_REPOSITORY,
} from '@server/modules/identity-access/identity-access.ports';
import type {
  PlatformMember,
} from '@server/modules/identity-access/identity-access.types';
import {
  StaleOpportunityReadinessService,
} from './stale-opportunity-readiness.service';

interface HistoryGovernanceControlReader {
  resolveTenantById(tenantId: string): Promise<TenantIntegration | null>;
}

interface HistoryGovernanceIdentityReader {
  resolveMemberById(
    tenantId: string,
    memberId: string,
  ): Promise<PlatformMember | null>;
}

interface HistoryGovernanceReadinessReader {
  generate(input: {
    integration: TenantIntegration;
    actorOpenId: string;
    now?: Date;
  }): Promise<StaleOpportunityReadinessResponse>;
}

interface HistoryGovernanceEvidenceInput {
  now?: Date;
}

const emptySummary = (): StaleOpportunityReadinessSummary => ({
  opportunityCount: 0,
  statusConfirmedCount: 0,
  statusNeedsConfirmationCount: 0,
  followupTimeConfirmedCount: 0,
  followupTimeNeedsConfirmationCount: 0,
  readyForScanCount: 0,
});

@Injectable()
class StaleOpportunityHistoryGovernanceEvidenceService {
  constructor(
    @Inject(AGENT_CONFIG)
    private readonly config: AgentRuntimeConfig,
    @Inject(CONTROL_STORE)
    private readonly controlStore: HistoryGovernanceControlReader,
    @Inject(IDENTITY_ACCESS_REPOSITORY)
    private readonly identity: HistoryGovernanceIdentityReader,
    @Inject(StaleOpportunityReadinessService)
    private readonly readiness: HistoryGovernanceReadinessReader,
  ) {}

  async inspect(
    input: HistoryGovernanceEvidenceInput = {},
  ): Promise<StaleOpportunityReminderHistoryGovernanceEvidence> {
    const now: Date = input.now ?? new Date();
    const execution = this.config.staleOpportunityReminder?.execution;
    const tenantId: string | undefined = execution?.allowedTenantId?.trim();
    const memberId: string | undefined = execution?.allowedMemberId?.trim();
    const recipientOpenId: string | undefined =
      execution?.allowedRecipientOpenId?.trim();
    if (!tenantId || !memberId || !recipientOpenId) {
      return this.empty(
        'not_checked',
        now,
        ['stale_opportunity_history_governance_target_not_configured'],
      );
    }

    let integration: TenantIntegration | null;
    let member: PlatformMember | null;
    try {
      [integration, member] = await Promise.all([
        this.controlStore.resolveTenantById(tenantId),
        this.identity.resolveMemberById(tenantId, memberId),
      ]);
    } catch (_error: unknown) {
      return this.empty(
        'unavailable',
        now,
        ['stale_opportunity_history_governance_target_unavailable'],
      );
    }
    if (
      integration === null || integration.tenantId !== tenantId ||
      integration.status !== 'active' || member === null ||
      member.tenantId !== tenantId || member.id !== memberId ||
      member.status !== 'active' || member.feishuOpenId !== recipientOpenId
    ) {
      return this.empty(
        'unavailable',
        now,
        ['stale_opportunity_history_governance_target_unavailable'],
      );
    }

    let report: StaleOpportunityReadinessResponse;
    try {
      report = await this.readiness.generate({
        integration,
        actorOpenId: recipientOpenId,
        now,
      });
    } catch (_error: unknown) {
      return this.empty(
        'unavailable',
        now,
        ['stale_opportunity_history_governance_source_unavailable'],
      );
    }
    if (report.status !== 'ready') {
      return {
        status: report.status,
        checkedAt: report.generatedAt,
        summary: report.summary,
        pendingItems: [],
        warnings: Array.from(new Set<string>([
          ...report.warnings,
          report.status === 'incomplete'
            ? 'stale_opportunity_history_governance_source_incomplete'
            : 'stale_opportunity_history_governance_source_unavailable',
        ])).sort(),
      };
    }

    const pendingItems: StaleOpportunityReadinessItem[] = report.items.filter(
      (item: StaleOpportunityReadinessItem): boolean =>
        item.blockers.length > 0,
    );
    const emptyScope: boolean = report.summary.opportunityCount === 0;
    const complete: boolean = !emptyScope && pendingItems.length === 0 &&
      report.summary.readyForScanCount === report.summary.opportunityCount;
    const warnings: string[] = [...report.warnings];
    if (emptyScope) {
      warnings.push('stale_opportunity_history_governance_scope_empty');
    } else if (!complete) {
      warnings.push('stale_opportunity_history_governance_pending');
    }
    return {
      status: complete ? 'complete' : 'incomplete',
      checkedAt: report.generatedAt,
      summary: report.summary,
      pendingItems,
      warnings: Array.from(new Set<string>(warnings)).sort(),
    };
  }

  private empty(
    status: 'unavailable' | 'not_checked',
    now: Date,
    warnings: string[],
  ): StaleOpportunityReminderHistoryGovernanceEvidence {
    return {
      status,
      checkedAt: now.toISOString(),
      summary: emptySummary(),
      pendingItems: [],
      warnings: Array.from(new Set<string>(warnings)).sort(),
    };
  }
}

export { StaleOpportunityHistoryGovernanceEvidenceService };
export type {
  HistoryGovernanceControlReader,
  HistoryGovernanceEvidenceInput,
  HistoryGovernanceIdentityReader,
  HistoryGovernanceReadinessReader,
};
