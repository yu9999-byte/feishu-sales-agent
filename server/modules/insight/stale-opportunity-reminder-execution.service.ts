import type {
  StaleOpportunityReminderExecutionOutcome,
  StaleOpportunityReminderExecutionRequest,
  StaleOpportunityReminderExecutionResponse,
  StaleOpportunityReminderHistoryGovernanceEvidence,
  StaleOpportunityReminderPlanResponse,
  StaleOpportunityReminderSenderEvidence,
  StaleOpportunityTriggerCandidate,
} from '@shared/api.interface';
import type { AgentRuntimeConfig } from '@server/config/agent.config';
import type {
  StaleOpportunityReminderPreparationInput,
  StaleOpportunityReminderPreparationResult,
} from './stale-opportunity-reminder-coordinator.service';

interface StaleOpportunityReminderExecutionInput
extends StaleOpportunityReminderExecutionRequest {
  now?: Date;
  traceId?: string;
}

interface StaleOpportunityReminderExecutionPlanRunner {
  plan(input?: {
    now?: Date;
    traceId?: string;
  }): Promise<StaleOpportunityReminderPlanResponse>;
}

interface StaleOpportunityReminderExecutionCoordinator {
  prepareAndDeliver(
    input: StaleOpportunityReminderPreparationInput,
  ): Promise<StaleOpportunityReminderPreparationResult>;
}

interface StaleOpportunityReminderExecutionGovernanceInspector {
  inspect(input?: { now?: Date }): Promise<
    StaleOpportunityReminderHistoryGovernanceEvidence
  >;
}

interface StaleOpportunityReminderExecutionSenderInspector {
  inspect(input?: { now?: Date }): Promise<
    StaleOpportunityReminderSenderEvidence
  >;
}

const IDEMPOTENT_SKIP_REASONS: Set<string> = new Set([
  'cooling_down',
  'in_flight',
  'retry_scheduled',
]);

class StaleOpportunityReminderExecutionService {
  constructor(
    private readonly config: AgentRuntimeConfig,
    private readonly planner: StaleOpportunityReminderExecutionPlanRunner,
    private readonly coordinator: StaleOpportunityReminderExecutionCoordinator,
    private readonly governance:
      StaleOpportunityReminderExecutionGovernanceInspector,
    private readonly sender: StaleOpportunityReminderExecutionSenderInspector,
  ) {}

  async execute(
    input: StaleOpportunityReminderExecutionInput,
  ): Promise<StaleOpportunityReminderExecutionResponse> {
    const now: Date = input.now ?? new Date();
    const execution = this.config.staleOpportunityReminder?.execution;
    if (execution?.enabled !== true) {
      return this.empty('disabled', now);
    }
    if (!this.hasCompleteExecutionConfig()) {
      return this.empty('blocked', now, [
        'stale_opportunity_reminder_execution_config_incomplete',
      ]);
    }
    if (!input.opportunityRecordId.trim() || !input.followupVersion.trim()) {
      return this.empty('incomplete', now, [
        'stale_opportunity_reminder_execution_request_invalid',
      ]);
    }

    let governance: StaleOpportunityReminderHistoryGovernanceEvidence;
    try {
      governance = await this.governance.inspect({ now });
    } catch (_error: unknown) {
      return this.empty('blocked', now, [
        'stale_opportunity_history_governance_evidence_unavailable',
      ]);
    }
    if (governance.status !== 'complete') {
      const warning: string = governance.status === 'incomplete'
        ? 'stale_opportunity_history_governance_evidence_incomplete'
        : 'stale_opportunity_history_governance_evidence_unavailable';
      return this.empty('blocked', now, [warning, ...governance.warnings]);
    }

    let sender: StaleOpportunityReminderSenderEvidence;
    try {
      sender = await this.sender.inspect({ now });
    } catch (_error: unknown) {
      return this.empty('blocked', now, [
        'stale_opportunity_sender_evidence_unavailable',
      ]);
    }
    if (sender.status !== 'complete') {
      const warning: string = sender.status === 'incomplete'
        ? 'stale_opportunity_sender_evidence_incomplete'
        : 'stale_opportunity_sender_evidence_unavailable';
      return this.empty('blocked', now, [warning, ...sender.warnings]);
    }

    let plan: StaleOpportunityReminderPlanResponse;
    try {
      plan = await this.planner.plan({
        now,
        traceId: input.traceId,
      });
    } catch (_error: unknown) {
      return this.empty('incomplete', now, [
        'stale_opportunity_reminder_execution_plan_unavailable',
      ]);
    }
    if (plan.status !== 'ready') {
      return this.empty(plan.status, now, plan.warnings, plan.scanTraceId);
    }
    const planTraceId: string | null = plan.scanTraceId;
    if (!this.isReadyPlanConsistent(plan) || planTraceId === null) {
      return this.empty('incomplete', now, [
        'stale_opportunity_reminder_execution_invalid_plan',
      ], planTraceId);
    }

    const matches: StaleOpportunityTriggerCandidate[] = plan.items.filter(
      (candidate: StaleOpportunityTriggerCandidate): boolean =>
        candidate.opportunityRecordId === input.opportunityRecordId &&
        candidate.followupVersion === input.followupVersion,
    );
    if (matches.length === 0) {
      return this.empty('candidate_not_found', now, [], planTraceId);
    }
    if (matches.length !== 1) {
      return this.empty('candidate_ambiguous', now, [
        'stale_opportunity_reminder_execution_candidate_ambiguous',
      ], planTraceId);
    }

    const candidate: StaleOpportunityTriggerCandidate = matches[0];
    if (!this.isAllowedCandidate(candidate)) {
      return this.result(
        'candidate_not_allowed',
        now,
        planTraceId,
        candidate,
        null,
        ['stale_opportunity_reminder_execution_candidate_not_allowed'],
      );
    }
    return this.deliver(candidate, now, planTraceId);
  }

  private async deliver(
    candidate: StaleOpportunityTriggerCandidate,
    now: Date,
    planTraceId: string,
  ): Promise<StaleOpportunityReminderExecutionResponse> {
    let outcome: StaleOpportunityReminderExecutionOutcome;
    try {
      outcome = await this.coordinator.prepareAndDeliver({
        enabled: true,
        tenantId: candidate.tenantId,
        memberId: candidate.memberId,
        evidence: {
          opportunityRecordId: candidate.opportunityRecordId,
          opportunityName: candidate.opportunityName,
          ownerOpenId: candidate.ownerOpenId,
          followupRecordId: candidate.followupRecordId,
          lastEffectiveFollowupAt: candidate.lastEffectiveFollowupAt,
          followupVersion: candidate.followupVersion,
        },
        now,
      });
    } catch (_error: unknown) {
      outcome = {
        status: 'failed',
        reason: 'execution_unavailable',
      };
    }
    const completed: boolean = outcome.status === 'sent' || (
      outcome.status === 'skipped' &&
      IDEMPOTENT_SKIP_REASONS.has(outcome.reason)
    );
    return this.result(
      completed ? 'completed' : 'halted',
      now,
      planTraceId,
      candidate,
      outcome,
      completed ? [] : ['stale_opportunity_reminder_execution_halted'],
    );
  }

  private hasCompleteExecutionConfig(): boolean {
    const execution = this.config.staleOpportunityReminder?.execution;
    const executionToken: string | undefined = execution?.triggerToken?.trim();
    const scanToken: string | undefined =
      this.config.staleOpportunityScan?.triggerToken?.trim();
    return Boolean(
      executionToken &&
      executionToken !== scanToken &&
      execution.allowedTenantId?.trim() &&
      execution.allowedMemberId?.trim() &&
      execution.allowedRecipientOpenId?.trim(),
    );
  }

  private isAllowedCandidate(
    candidate: StaleOpportunityTriggerCandidate,
  ): boolean {
    const execution = this.config.staleOpportunityReminder?.execution;
    return candidate.tenantId === execution?.allowedTenantId &&
      candidate.memberId === execution.allowedMemberId &&
      candidate.ownerOpenId === execution.allowedRecipientOpenId;
  }

  private isReadyPlanConsistent(
    plan: StaleOpportunityReminderPlanResponse,
  ): boolean {
    return plan.preflight.status === 'ready' &&
      plan.scanTraceId !== null &&
      plan.scanTraceId.trim().length > 0 &&
      plan.summary.candidateCount === plan.items.length &&
      plan.summary.suppressedCandidateCount === 0;
  }

  private empty(
    status: Exclude<
      StaleOpportunityReminderExecutionResponse['status'],
      'completed' | 'halted' | 'candidate_not_allowed'
    >,
    now: Date,
    warnings: string[] = [],
    planTraceId: string | null = null,
  ): StaleOpportunityReminderExecutionResponse {
    return this.result(
      status,
      now,
      planTraceId,
      null,
      null,
      warnings,
    );
  }

  private result(
    status: StaleOpportunityReminderExecutionResponse['status'],
    now: Date,
    planTraceId: string | null,
    candidate: StaleOpportunityTriggerCandidate | null,
    outcome: StaleOpportunityReminderExecutionOutcome | null,
    warnings: string[],
  ): StaleOpportunityReminderExecutionResponse {
    return {
      mode: 'controlled-delivery',
      status,
      generatedAt: now.toISOString(),
      planTraceId,
      candidate,
      outcome,
      warnings: Array.from(new Set<string>(warnings)).sort(),
    };
  }
}

export { StaleOpportunityReminderExecutionService };
export type {
  StaleOpportunityReminderExecutionCoordinator,
  StaleOpportunityReminderExecutionGovernanceInspector,
  StaleOpportunityReminderExecutionInput,
  StaleOpportunityReminderExecutionPlanRunner,
  StaleOpportunityReminderExecutionSenderInspector,
};
