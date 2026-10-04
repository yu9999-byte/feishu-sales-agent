import { randomUUID } from 'node:crypto';

import { Inject, Injectable, Logger } from '@nestjs/common';

import type {
  PlatformSessionResponse,
  StaleOpportunityTriggerAuditEvidence,
  StaleOpportunityTriggerCandidate,
  StaleOpportunityTriggerResponse,
  StaleOpportunityTriggerSkip,
} from '@shared/api.interface';
import {
  AGENT_CONFIG,
  type AgentRuntimeConfig,
} from '@server/config/agent.config';
import {
  CONTROL_STORE,
  SALES_RECORDS_GATEWAY,
  TASK_GATEWAY,
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
  PlatformAccessDeniedError,
  PlatformSessionService,
} from '@server/modules/platform-shell/platform-session.service';
import {
  StaleOpportunityScanService,
  type StaleOpportunityRecordsReader,
  type StaleOpportunityScanResult,
  type StaleOpportunityScanSkip,
  type StaleOpportunityTaskReader,
} from './stale-opportunity-scan.service';

interface StaleOpportunityTriggerRunInput {
  now?: Date;
  traceId?: string;
}

interface StaleOpportunityTriggerControlReader {
  resolveTenantById(tenantId: string): Promise<TenantIntegration | null>;
  listActiveIntegrations?(): Promise<TenantIntegration[]>;
}

interface StaleOpportunityTriggerIdentityReader {
  listMembers(tenantId: string): Promise<PlatformMember[]>;
}

interface StaleOpportunityTriggerSessionReader {
  getSessionByMembership(
    tenantId: string,
    memberId: string,
    occurredAt?: Date,
  ): Promise<PlatformSessionResponse>;
}

interface MutableTriggerSummary {
  tenantCount: number;
  memberCount: number;
  scannedMemberCount: number;
  skippedMemberCount: number;
  incompleteMemberCount: number;
}

interface TriggerAccumulator {
  candidates: StaleOpportunityTriggerCandidate[];
  skips: StaleOpportunityTriggerSkip[];
  audit: StaleOpportunityTriggerAuditEvidence[];
  warnings: string[];
  summary: MutableTriggerSummary;
  incomplete: boolean;
}

const createSummary = (tenantCount: number): MutableTriggerSummary => ({
  tenantCount,
  memberCount: 0,
  scannedMemberCount: 0,
  skippedMemberCount: 0,
  incompleteMemberCount: 0,
});

@Injectable()
class StaleOpportunityTriggerService {
  private readonly logger: Logger = new Logger(
    StaleOpportunityTriggerService.name,
  );
  private readonly scanner: StaleOpportunityScanService;

  constructor(
    @Inject(AGENT_CONFIG)
    private readonly config: AgentRuntimeConfig,
    @Inject(CONTROL_STORE)
    private readonly controlStore: StaleOpportunityTriggerControlReader,
    @Inject(IDENTITY_ACCESS_REPOSITORY)
    private readonly identity: StaleOpportunityTriggerIdentityReader,
    @Inject(PlatformSessionService)
    private readonly sessions: StaleOpportunityTriggerSessionReader,
    @Inject(SALES_RECORDS_GATEWAY)
    records: StaleOpportunityRecordsReader,
    @Inject(TASK_GATEWAY)
    tasks: StaleOpportunityTaskReader,
  ) {
    this.scanner = new StaleOpportunityScanService(records, tasks);
  }

  async run(
    input: StaleOpportunityTriggerRunInput = {},
  ): Promise<StaleOpportunityTriggerResponse> {
    const now: Date = input.now ?? new Date();
    const traceId: string = input.traceId ?? randomUUID();
    if (this.config.staleOpportunityScan?.enabled !== true) {
      return this.disabled(traceId, now);
    }

    const integrations: TenantIntegration[] | null =
      await this.listIntegrations();
    if (integrations === null) {
      return this.integrationEnumerationFailure(traceId, now);
    }

    const state: TriggerAccumulator = {
      candidates: [],
      skips: [],
      audit: [],
      warnings: [],
      summary: createSummary(integrations.length),
      incomplete: false,
    };
    for (const integration of integrations) {
      await this.scanTenant(integration, now, state);
    }
    return this.finalize(traceId, now, state);
  }

  private async listIntegrations(): Promise<TenantIntegration[] | null> {
    if (!this.controlStore.listActiveIntegrations) {
      return null;
    }
    try {
      const integrations: TenantIntegration[] =
        await this.controlStore.listActiveIntegrations();
      return [...integrations].sort(
        (left: TenantIntegration, right: TenantIntegration): number =>
          left.tenantId.localeCompare(right.tenantId),
      );
    } catch (_error: unknown) {
      return null;
    }
  }

  private async scanTenant(
    listedIntegration: TenantIntegration,
    now: Date,
    state: TriggerAccumulator,
  ): Promise<void> {
    let integration: TenantIntegration | null;
    try {
      integration = await this.controlStore.resolveTenantById(
        listedIntegration.tenantId,
      );
    } catch (_error: unknown) {
      integration = null;
    }
    if (integration === null || integration.status !== 'active') {
      this.failTenant(listedIntegration.tenantId, state);
      return;
    }

    let members: PlatformMember[];
    try {
      members = await this.identity.listMembers(integration.tenantId);
    } catch (_error: unknown) {
      this.failTenant(integration.tenantId, state);
      return;
    }
    state.summary.memberCount += members.length;
    const orderedMembers: PlatformMember[] = [...members].sort(
      (left: PlatformMember, right: PlatformMember): number =>
        left.id.localeCompare(right.id),
    );
    for (const member of orderedMembers) {
      await this.scanMember(integration, member, now, state);
    }
  }

  private async scanMember(
    integration: TenantIntegration,
    member: PlatformMember,
    now: Date,
    state: TriggerAccumulator,
  ): Promise<void> {
    if (member.tenantId !== integration.tenantId) {
      state.incomplete = true;
      state.summary.incompleteMemberCount += 1;
      this.addMemberSkip(
        integration.tenantId,
        member.id,
        'member_tenant_mismatch',
        'failed',
        state,
      );
      return;
    }
    if (member.status !== 'active') {
      state.summary.skippedMemberCount += 1;
      this.addMemberSkip(
        integration.tenantId,
        member.id,
        'member_inactive',
        'skipped',
        state,
      );
      return;
    }

    let session: PlatformSessionResponse;
    try {
      session = await this.sessions.getSessionByMembership(
        integration.tenantId,
        member.id,
        now,
      );
    } catch (error: unknown) {
      if (error instanceof PlatformAccessDeniedError) {
        state.summary.skippedMemberCount += 1;
        this.addMemberSkip(
          integration.tenantId,
          member.id,
          'authorization_denied',
          'skipped',
          state,
        );
        return;
      }
      state.incomplete = true;
      state.summary.incompleteMemberCount += 1;
      this.addMemberSkip(
        integration.tenantId,
        member.id,
        'source_unverified',
        'failed',
        state,
      );
      return;
    }
    if (!session.permissions.includes('review:read-personal')) {
      state.summary.skippedMemberCount += 1;
      this.addMemberSkip(
        integration.tenantId,
        member.id,
        'permission_missing',
        'skipped',
        state,
      );
      return;
    }

    if (
      session.tenant.id !== integration.tenantId ||
      session.member.id !== member.id ||
      session.member.feishuOpenId !== member.feishuOpenId
    ) {
      state.incomplete = true;
      state.summary.incompleteMemberCount += 1;
      this.addMemberSkip(
        integration.tenantId,
        member.id,
        'source_unverified',
        'failed',
        state,
      );
      return;
    }

    let result: StaleOpportunityScanResult;
    try {
      result = await this.scanner.scan({
        enabled: true,
        integration,
        actorOpenId: session.member.feishuOpenId,
        timezone: session.tenant.timezone,
        now,
      });
    } catch (_error: unknown) {
      result = {
        status: 'incomplete',
        candidates: [],
        skips: [{
          opportunityRecordId: null,
          opportunityName: null,
          reason: 'source_unverified',
        }],
        warnings: ['stale_opportunity_scan_unavailable'],
      };
    }
    state.summary.scannedMemberCount += 1;
    this.collectScanResult(integration.tenantId, member.id, result, state);
  }

  private collectScanResult(
    tenantId: string,
    memberId: string,
    result: StaleOpportunityScanResult,
    state: TriggerAccumulator,
  ): void {
    const memberSkips: StaleOpportunityTriggerSkip[] = result.skips.map(
      (skip: StaleOpportunityScanSkip): StaleOpportunityTriggerSkip => ({
        tenantId,
        memberId,
        opportunityRecordId: skip.opportunityRecordId,
        opportunityName: skip.opportunityName,
        reason: skip.reason,
      }),
    );
    state.skips.push(...memberSkips);
    state.warnings.push(...result.warnings);
    if (result.status !== 'complete') {
      state.incomplete = true;
      state.summary.incompleteMemberCount += 1;
      state.audit.push({
        scope: 'member',
        tenantId,
        memberId,
        outcome: 'failed',
        code: 'scan_incomplete',
        candidateCount: 0,
        skipCount: memberSkips.length,
      });
      return;
    }
    state.candidates.push(...result.candidates.map(
      (candidate): StaleOpportunityTriggerCandidate => ({
        tenantId,
        memberId,
        opportunityRecordId: candidate.opportunityRecordId,
        opportunityName: candidate.opportunityName,
        ownerOpenId: candidate.ownerOpenId,
        followupRecordId: candidate.followupRecordId,
        lastEffectiveFollowupAt: candidate.lastEffectiveFollowupAt,
        followupVersion: candidate.followupVersion,
      }),
    ));
    state.audit.push({
      scope: 'member',
      tenantId,
      memberId,
      outcome: 'completed',
      code: 'scan_complete',
      candidateCount: result.candidates.length,
      skipCount: memberSkips.length,
    });
  }

  private addMemberSkip(
    tenantId: string,
    memberId: string,
    reason: StaleOpportunityTriggerSkip['reason'],
    outcome: 'skipped' | 'failed',
    state: TriggerAccumulator,
  ): void {
    state.skips.push({
      tenantId,
      memberId,
      opportunityRecordId: null,
      opportunityName: null,
      reason,
    });
    state.audit.push({
      scope: 'member',
      tenantId,
      memberId,
      outcome,
      code: reason,
      candidateCount: 0,
      skipCount: 1,
    });
  }

  private failTenant(
    tenantId: string,
    state: TriggerAccumulator,
  ): void {
    state.incomplete = true;
    state.skips.push({
      tenantId,
      memberId: null,
      opportunityRecordId: null,
      opportunityName: null,
      reason: 'tenant_unavailable',
    });
    state.audit.push({
      scope: 'tenant',
      tenantId,
      memberId: null,
      outcome: 'failed',
      code: 'tenant_unavailable',
      candidateCount: 0,
      skipCount: 1,
    });
    state.warnings.push('stale_opportunity_tenant_unavailable');
  }

  private finalize(
    traceId: string,
    now: Date,
    state: TriggerAccumulator,
  ): StaleOpportunityTriggerResponse {
    const observedCandidateCount: number = state.candidates.length;
    const candidates: StaleOpportunityTriggerCandidate[] = state.incomplete
      ? []
      : state.candidates;
    if (state.incomplete && observedCandidateCount > 0) {
      state.audit.push({
        scope: 'batch',
        tenantId: null,
        memberId: null,
        outcome: 'suppressed',
        code: 'batch_incomplete',
        candidateCount: observedCandidateCount,
        skipCount: state.skips.length,
      });
    }
    const warnings: string[] = Array.from(new Set<string>([
      ...state.warnings,
      ...(state.incomplete ? ['stale_opportunity_batch_incomplete'] : []),
    ])).sort();
    const response: StaleOpportunityTriggerResponse = {
      traceId,
      generatedAt: now.toISOString(),
      mode: 'dry-run',
      status: state.incomplete ? 'incomplete' : 'complete',
      summary: {
        ...state.summary,
        candidateCount: candidates.length,
        suppressedCandidateCount: state.incomplete
          ? observedCandidateCount
          : 0,
        skipCount: state.skips.length,
      },
      candidates,
      skips: state.skips,
      audit: state.audit,
      warnings,
    };
    this.logger.log(
      `Stale opportunity dry-run ${response.status}; ` +
      `trace=${traceId}; tenants=${response.summary.tenantCount}; ` +
      `members=${response.summary.scannedMemberCount}; ` +
      `candidates=${response.summary.candidateCount}`,
    );
    return response;
  }

  private disabled(
    traceId: string,
    now: Date,
  ): StaleOpportunityTriggerResponse {
    return {
      traceId,
      generatedAt: now.toISOString(),
      mode: 'dry-run',
      status: 'disabled',
      summary: {
        ...createSummary(0),
        candidateCount: 0,
        suppressedCandidateCount: 0,
        skipCount: 1,
      },
      candidates: [],
      skips: [{
        tenantId: null,
        memberId: null,
        opportunityRecordId: null,
        opportunityName: null,
        reason: 'disabled',
      }],
      audit: [{
        scope: 'batch',
        tenantId: null,
        memberId: null,
        outcome: 'skipped',
        code: 'disabled',
        candidateCount: 0,
        skipCount: 1,
      }],
      warnings: [],
    };
  }

  private integrationEnumerationFailure(
    traceId: string,
    now: Date,
  ): StaleOpportunityTriggerResponse {
    return {
      traceId,
      generatedAt: now.toISOString(),
      mode: 'dry-run',
      status: 'incomplete',
      summary: {
        ...createSummary(0),
        candidateCount: 0,
        suppressedCandidateCount: 0,
        skipCount: 1,
      },
      candidates: [],
      skips: [{
        tenantId: null,
        memberId: null,
        opportunityRecordId: null,
        opportunityName: null,
        reason: 'source_unverified',
      }],
      audit: [{
        scope: 'batch',
        tenantId: null,
        memberId: null,
        outcome: 'failed',
        code: 'integration_enumeration_unavailable',
        candidateCount: 0,
        skipCount: 1,
      }],
      warnings: ['stale_opportunity_integration_enumeration_unavailable'],
    };
  }
}

export { StaleOpportunityTriggerService };
export type {
  StaleOpportunityTriggerControlReader,
  StaleOpportunityTriggerIdentityReader,
  StaleOpportunityTriggerRunInput,
  StaleOpportunityTriggerSessionReader,
};
