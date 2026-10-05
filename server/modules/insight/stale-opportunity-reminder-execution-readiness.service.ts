import { Inject, Injectable } from '@nestjs/common';

import type {
  PlatformSessionResponse,
  StaleOpportunityReminderExecutionReadinessBlocker,
  StaleOpportunityReminderExecutionReadinessCandidateProbe,
  StaleOpportunityReminderExecutionReadinessLedger,
  StaleOpportunityReminderExecutionReadinessResponse,
  StaleOpportunityReminderExecutionReadinessTarget,
  StaleOpportunityReminderHistoryGovernanceEvidence,
  StaleOpportunityTriggerCandidate,
  StaleOpportunityTriggerResponse,
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
  PlatformSessionService,
} from '@server/modules/platform-shell/platform-session.service';
import {
  StaleOpportunityHistoryGovernanceEvidenceService,
} from './stale-opportunity-history-governance-evidence.service';
import type {
  StaleOpportunityReminderUncertainReader,
} from './stale-opportunity-reminder.service';
import {
  STALE_OPPORTUNITY_REMINDER_UNCERTAIN_READER,
} from './stale-opportunity-reminder-runtime.service';
import {
  StaleOpportunityTriggerService,
} from './stale-opportunity-trigger.service';

interface ExecutionReadinessControlReader {
  resolveTenantById(tenantId: string): Promise<TenantIntegration | null>;
}

interface ExecutionReadinessIdentityReader {
  resolveMemberById(
    tenantId: string,
    memberId: string,
  ): Promise<PlatformMember | null>;
}

interface ExecutionReadinessSessionReader {
  getSessionByMembership(
    tenantId: string,
    memberId: string,
    occurredAt?: Date,
  ): Promise<PlatformSessionResponse>;
}

interface ExecutionReadinessCandidateRunner {
  run(input?: {
    now?: Date;
    traceId?: string;
    tenantId?: string;
    memberId?: string;
  }): Promise<
    StaleOpportunityTriggerResponse
  >;
}

interface ExecutionReadinessHistoryGovernanceInspector {
  inspect(input?: { now?: Date }): Promise<
    StaleOpportunityReminderHistoryGovernanceEvidence
  >;
}

interface ExecutionReadinessInput {
  now?: Date;
  traceId?: string;
}

const emptyTarget = (
  tenantId: string | null,
  memberId: string | null,
  recipientOpenId: string | null,
): StaleOpportunityReminderExecutionReadinessTarget => ({
  tenantId,
  tenantName: null,
  tenantStatus: tenantId === null ? 'not_configured' : 'unavailable',
  memberId,
  memberDisplayName: null,
  memberStatus: memberId === null ? 'not_configured' : 'unavailable',
  recipientOpenId,
  recipientOpenIdMatches: null,
  permissionGranted: null,
  dataSourceConfigured: null,
});

const emptyLedger = (): StaleOpportunityReminderExecutionReadinessLedger => ({
  status: 'not_checked',
  uncertainDeliveryFound: false,
});

const emptyHistoryGovernance = (
  now: Date,
): StaleOpportunityReminderHistoryGovernanceEvidence => ({
  status: 'not_checked',
  checkedAt: now.toISOString(),
  summary: {
    opportunityCount: 0,
    statusConfirmedCount: 0,
    statusNeedsConfirmationCount: 0,
    followupTimeConfirmedCount: 0,
    followupTimeNeedsConfirmationCount: 0,
    readyForScanCount: 0,
  },
  pendingItems: [],
  warnings: ['stale_opportunity_history_governance_target_not_verified'],
});

const emptyCandidateProbe = (
  status: StaleOpportunityReminderExecutionReadinessCandidateProbe['status'],
): StaleOpportunityReminderExecutionReadinessCandidateProbe => ({
  status,
  traceId: null,
  candidateCount: 0,
  matchingCandidateCount: 0,
  items: [],
  warnings: [],
});

@Injectable()
class StaleOpportunityReminderExecutionReadinessService {
  constructor(
    @Inject(AGENT_CONFIG)
    private readonly config: AgentRuntimeConfig,
    @Inject(CONTROL_STORE)
    private readonly controlStore: ExecutionReadinessControlReader,
    @Inject(IDENTITY_ACCESS_REPOSITORY)
    private readonly identity: ExecutionReadinessIdentityReader,
    @Inject(PlatformSessionService)
    private readonly sessions: ExecutionReadinessSessionReader,
    @Inject(STALE_OPPORTUNITY_REMINDER_UNCERTAIN_READER)
    private readonly uncertainReader: StaleOpportunityReminderUncertainReader,
    @Inject(StaleOpportunityTriggerService)
    private readonly candidates: ExecutionReadinessCandidateRunner,
    @Inject(StaleOpportunityHistoryGovernanceEvidenceService)
    private readonly historyGovernance:
      ExecutionReadinessHistoryGovernanceInspector,
  ) {}

  async inspect(
    input: ExecutionReadinessInput = {},
  ): Promise<StaleOpportunityReminderExecutionReadinessResponse> {
    const now: Date = input.now ?? new Date();
    const scan = this.config.staleOpportunityScan;
    const reminder = this.config.staleOpportunityReminder;
    const execution = reminder?.execution;
    const executionToken: string | undefined = execution?.triggerToken?.trim();
    const scanToken: string | undefined = scan?.triggerToken?.trim();
    const tenantId: string | null =
      execution?.allowedTenantId?.trim() || null;
    const memberId: string | null =
      execution?.allowedMemberId?.trim() || null;
    const recipientOpenId: string | null =
      execution?.allowedRecipientOpenId?.trim() || null;
    const allowlistConfigured: boolean =
      tenantId !== null && memberId !== null && recipientOpenId !== null;
    const blockers: StaleOpportunityReminderExecutionReadinessBlocker[] = [];
    const addBlocker = (
      blocker: StaleOpportunityReminderExecutionReadinessBlocker,
    ): void => {
      if (!blockers.includes(blocker)) blockers.push(blocker);
    };

    if (execution?.enabled === true) addBlocker('execution_enabled');
    if (reminder?.enabled === true) addBlocker('reminder_enabled');
    if (!executionToken) addBlocker('execution_token_missing');
    if (executionToken && scanToken && executionToken === scanToken) {
      addBlocker('execution_token_reused');
    }
    if (scan?.enabled !== true) addBlocker('scan_disabled');
    if (!scanToken) addBlocker('scan_token_missing');
    if (!allowlistConfigured) addBlocker('execution_allowlist_incomplete');
    if (reminder?.historyGovernanceReady !== true) {
      addBlocker('history_governance_incomplete');
    }
    if (reminder?.senderConfigured !== true) {
      addBlocker('sender_unconfigured');
    }

    const target: StaleOpportunityReminderExecutionReadinessTarget =
      emptyTarget(tenantId, memberId, recipientOpenId);
    const integration: TenantIntegration | null = await this.readIntegration(
      tenantId,
      target,
      addBlocker,
    );
    const member: PlatformMember | null = await this.readMember(
      tenantId,
      memberId,
      target,
      addBlocker,
    );
    const targetVerified: boolean = await this.verifyTarget(
      now,
      tenantId,
      memberId,
      recipientOpenId,
      integration,
      member,
      target,
      addBlocker,
    );
    const historyGovernance: StaleOpportunityReminderHistoryGovernanceEvidence =
      targetVerified
        ? await this.historyGovernance.inspect({ now })
        : emptyHistoryGovernance(now);
    if (historyGovernance.status !== 'complete') {
      addBlocker('history_governance_incomplete');
    }
    const ledger: StaleOpportunityReminderExecutionReadinessLedger =
      await this.inspectLedger(tenantId, addBlocker);
    const candidateProbe:
      StaleOpportunityReminderExecutionReadinessCandidateProbe =
      await this.inspectCandidates(
        now,
        input.traceId,
        tenantId,
        memberId,
        recipientOpenId,
        targetVerified,
        addBlocker,
      );
    const warnings: string[] = Array.from(new Set<string>([
      ...historyGovernance.warnings,
      ...candidateProbe.warnings,
    ])).sort();

    return {
      mode: 'read-only',
      status: blockers.length === 0
        ? 'ready_for_manual_activation'
        : 'blocked',
      checkedAt: now.toISOString(),
      configuration: {
        executionEnabled: execution?.enabled === true,
        reminderEnabled: reminder?.enabled === true,
        scanEnabled: scan?.enabled === true,
        executionTokenConfigured: Boolean(executionToken),
        scanTokenConfigured: Boolean(scanToken),
        executionTokenDistinctFromScan: Boolean(
          executionToken && scanToken && executionToken !== scanToken,
        ),
        allowlistConfigured,
        historyGovernanceReady: reminder?.historyGovernanceReady === true,
        senderConfigured: reminder?.senderConfigured === true,
      },
      target,
      historyGovernance,
      ledger,
      candidateProbe,
      blockers,
      warnings,
    };
  }

  private async readIntegration(
    tenantId: string | null,
    target: StaleOpportunityReminderExecutionReadinessTarget,
    addBlocker: (
      blocker: StaleOpportunityReminderExecutionReadinessBlocker,
    ) => void,
  ): Promise<TenantIntegration | null> {
    if (tenantId === null) return null;
    let integration: TenantIntegration | null;
    try {
      integration = await this.controlStore.resolveTenantById(tenantId);
    } catch (_error: unknown) {
      integration = null;
    }
    if (integration === null || integration.tenantId !== tenantId) {
      addBlocker('target_tenant_unavailable');
      return null;
    }
    target.tenantName = integration.name;
    target.tenantStatus = integration.status === 'active'
      ? 'active'
      : 'inactive';
    target.dataSourceConfigured = this.isDataSourceConfigured(integration);
    if (integration.status !== 'active') {
      addBlocker('target_tenant_inactive');
    }
    if (target.dataSourceConfigured !== true) {
      addBlocker('data_source_unconfigured');
    }
    return integration;
  }

  private async readMember(
    tenantId: string | null,
    memberId: string | null,
    target: StaleOpportunityReminderExecutionReadinessTarget,
    addBlocker: (
      blocker: StaleOpportunityReminderExecutionReadinessBlocker,
    ) => void,
  ): Promise<PlatformMember | null> {
    if (tenantId === null || memberId === null) return null;
    let member: PlatformMember | null;
    try {
      member = await this.identity.resolveMemberById(tenantId, memberId);
    } catch (_error: unknown) {
      member = null;
    }
    if (member === null || member.tenantId !== tenantId) {
      addBlocker('target_member_unavailable');
      return null;
    }
    target.memberDisplayName = member.displayName;
    target.memberStatus = member.status === 'active' ? 'active' : 'inactive';
    if (member.status !== 'active') addBlocker('target_member_inactive');
    return member;
  }

  private async verifyTarget(
    now: Date,
    tenantId: string | null,
    memberId: string | null,
    recipientOpenId: string | null,
    integration: TenantIntegration | null,
    member: PlatformMember | null,
    target: StaleOpportunityReminderExecutionReadinessTarget,
    addBlocker: (
      blocker: StaleOpportunityReminderExecutionReadinessBlocker,
    ) => void,
  ): Promise<boolean> {
    if (
      tenantId === null || memberId === null || recipientOpenId === null ||
      integration?.status !== 'active' || member?.status !== 'active'
    ) {
      return false;
    }
    target.recipientOpenIdMatches = member.feishuOpenId === recipientOpenId;
    if (!target.recipientOpenIdMatches) {
      addBlocker('recipient_open_id_mismatch');
      return false;
    }
    try {
      const session: PlatformSessionResponse =
        await this.sessions.getSessionByMembership(tenantId, memberId, now);
      const identityMatches: boolean =
        session.tenant.id === tenantId &&
        session.member.id === memberId &&
        session.member.feishuOpenId === recipientOpenId;
      target.permissionGranted = identityMatches &&
        session.permissions.includes('review:read-personal');
    } catch (_error: unknown) {
      target.permissionGranted = false;
    }
    if (target.permissionGranted !== true) {
      addBlocker('permission_missing');
      return false;
    }
    return target.dataSourceConfigured === true;
  }

  private async inspectLedger(
    tenantId: string | null,
    addBlocker: (
      blocker: StaleOpportunityReminderExecutionReadinessBlocker,
    ) => void,
  ): Promise<StaleOpportunityReminderExecutionReadinessLedger> {
    if (tenantId === null) return emptyLedger();
    try {
      const records = await this.uncertainReader.listUncertain({
        tenantId,
        limit: 1,
      });
      if (records.length > 0) {
        addBlocker('uncertain_delivery_present');
        return { status: 'uncertain', uncertainDeliveryFound: true };
      }
      return { status: 'clear', uncertainDeliveryFound: false };
    } catch (_error: unknown) {
      addBlocker('reconciliation_unavailable');
      return { status: 'unavailable', uncertainDeliveryFound: false };
    }
  }

  private async inspectCandidates(
    now: Date,
    traceId: string | undefined,
    tenantId: string | null,
    memberId: string | null,
    recipientOpenId: string | null,
    targetVerified: boolean,
    addBlocker: (
      blocker: StaleOpportunityReminderExecutionReadinessBlocker,
    ) => void,
  ): Promise<StaleOpportunityReminderExecutionReadinessCandidateProbe> {
    const scan = this.config.staleOpportunityScan;
    if (scan?.enabled !== true) return emptyCandidateProbe('disabled');
    if (!scan.triggerToken?.trim() || !targetVerified) {
      return emptyCandidateProbe('not_checked');
    }
    let result: StaleOpportunityTriggerResponse;
    try {
      result = await this.candidates.run({
        now,
        traceId,
        tenantId: tenantId ?? undefined,
        memberId: memberId ?? undefined,
      });
    } catch (_error: unknown) {
      addBlocker('candidate_probe_incomplete');
      return {
        ...emptyCandidateProbe('incomplete'),
        warnings: ['stale_opportunity_execution_readiness_probe_unavailable'],
      };
    }
    if (result.status !== 'complete') {
      addBlocker('candidate_probe_incomplete');
      return {
        ...emptyCandidateProbe(
          result.status === 'disabled' ? 'disabled' : 'incomplete',
        ),
        traceId: result.traceId,
        candidateCount: result.summary.candidateCount,
        warnings: result.warnings,
      };
    }
    const matching: StaleOpportunityTriggerCandidate[] =
      result.candidates.filter(
        (candidate: StaleOpportunityTriggerCandidate): boolean =>
          candidate.tenantId === tenantId &&
          candidate.memberId === memberId &&
          candidate.ownerOpenId === recipientOpenId,
      );
    if (matching.length === 0) {
      addBlocker(
        result.candidates.length === 0
          ? 'candidate_not_found'
          : 'candidate_not_allowed',
      );
    } else if (matching.length > 1) {
      addBlocker('candidate_ambiguous');
    }
    return {
      status: 'complete',
      traceId: result.traceId,
      candidateCount: result.candidates.length,
      matchingCandidateCount: matching.length,
      items: matching,
      warnings: result.warnings,
    };
  }

  private isDataSourceConfigured(integration: TenantIntegration): boolean {
    const secret: string | undefined =
      process.env[integration.appSecretEnv]?.trim();
    return Boolean(
      integration.appId.trim() &&
      integration.appSecretEnv.trim() &&
      secret &&
      integration.base.appToken.trim() &&
      integration.base.opportunities.tableId.trim() &&
      integration.base.opportunities.fields.opportunityName.trim() &&
      integration.base.opportunities.fields.ownerOpenId?.trim() &&
      integration.base.opportunities.fields.status?.trim() &&
      integration.base.opportunities.statusValues?.active.length &&
      integration.base.followups.tableId.trim() &&
      integration.base.followups.fields.opportunityLink.trim() &&
      integration.base.followups.fields.ownerOpenId?.trim() &&
      integration.base.followups.fields.communicationAt?.trim(),
    );
  }
}

export { StaleOpportunityReminderExecutionReadinessService };
export type {
  ExecutionReadinessCandidateRunner,
  ExecutionReadinessControlReader,
  ExecutionReadinessHistoryGovernanceInspector,
  ExecutionReadinessIdentityReader,
  ExecutionReadinessInput,
  ExecutionReadinessSessionReader,
};
