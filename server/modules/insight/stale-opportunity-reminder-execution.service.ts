import type {
  StaleOpportunityReminderPlanResponse,
  StaleOpportunityTriggerCandidate,
} from '@shared/api.interface';
import type {
  StaleOpportunityReminderPreparationInput,
  StaleOpportunityReminderPreparationResult,
} from './stale-opportunity-reminder-coordinator.service';

interface StaleOpportunityReminderExecutionInput {
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

type StaleOpportunityReminderExecutionItemResult =
  | StaleOpportunityReminderPreparationResult
  | {
      status: 'failed';
      reason: 'execution_unavailable';
    };

interface StaleOpportunityReminderExecutionOutcome {
  candidate: StaleOpportunityTriggerCandidate;
  result: StaleOpportunityReminderExecutionItemResult;
}

interface StaleOpportunityReminderExecutionSummary {
  plannedCount: number;
  processedCount: number;
  sentCount: number;
  skippedCount: number;
  failedCount: number;
  remainingCount: number;
}

interface StaleOpportunityReminderExecutionResult {
  status: 'disabled' | 'blocked' | 'incomplete' | 'completed' | 'halted';
  generatedAt: string;
  plan: StaleOpportunityReminderPlanResponse | null;
  summary: StaleOpportunityReminderExecutionSummary;
  outcomes: StaleOpportunityReminderExecutionOutcome[];
  warnings: string[];
}

class StaleOpportunityReminderExecutionService {
  constructor(
    private readonly planner: StaleOpportunityReminderExecutionPlanRunner,
    private readonly coordinator: StaleOpportunityReminderExecutionCoordinator,
  ) {}

  async execute(
    input: StaleOpportunityReminderExecutionInput = {},
  ): Promise<StaleOpportunityReminderExecutionResult> {
    const now: Date = input.now ?? new Date();
    let plan: StaleOpportunityReminderPlanResponse;
    try {
      plan = await this.planner.plan({ now, traceId: input.traceId });
    } catch (_error: unknown) {
      return this.empty(
        'incomplete',
        now,
        null,
        ['stale_opportunity_reminder_execution_plan_unavailable'],
      );
    }
    if (plan.status !== 'ready') {
      return this.empty(plan.status, now, plan);
    }
    if (!this.isReadyPlanConsistent(plan)) {
      return this.empty(
        'incomplete',
        now,
        plan,
        ['stale_opportunity_reminder_execution_invalid_plan'],
      );
    }
    if (this.hasDuplicateCandidate(plan.items)) {
      return this.empty(
        'incomplete',
        now,
        plan,
        ['stale_opportunity_reminder_execution_duplicate_candidate'],
      );
    }

    const outcomes: StaleOpportunityReminderExecutionOutcome[] = [];
    const warnings: string[] = [];
    let halted: boolean = false;
    for (const item of plan.items) {
      const result: StaleOpportunityReminderExecutionItemResult =
        await this.executeItem(item, now, warnings);
      outcomes.push({ candidate: item, result });
      if (this.shouldHalt(result)) {
        halted = true;
        warnings.push('stale_opportunity_reminder_execution_halted');
        break;
      }
    }
    return {
      status: halted ? 'halted' : 'completed',
      generatedAt: now.toISOString(),
      plan,
      summary: this.summarize(plan.items.length, outcomes),
      outcomes,
      warnings: Array.from(new Set<string>(warnings)).sort(),
    };
  }

  private async executeItem(
    candidate: StaleOpportunityTriggerCandidate,
    now: Date,
    warnings: string[],
  ): Promise<StaleOpportunityReminderExecutionItemResult> {
    try {
      return await this.coordinator.prepareAndDeliver({
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
      warnings.push('stale_opportunity_reminder_execution_unavailable');
      return { status: 'failed', reason: 'execution_unavailable' };
    }
  }

  private shouldHalt(
    result: StaleOpportunityReminderExecutionItemResult,
  ): boolean {
    if (result.status === 'failed') return true;
    return result.reason === 'source_unverified' ||
      result.reason === 'tenant_unavailable' ||
      result.reason === 'delivery_unknown' ||
      result.reason === 'invalid_evidence' ||
      result.reason === 'owner_mismatch' ||
      result.reason === 'disabled';
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

  private hasDuplicateCandidate(
    candidates: StaleOpportunityTriggerCandidate[],
  ): boolean {
    const keys: Set<string> = new Set();
    for (const candidate of candidates) {
      const key: string = JSON.stringify([
        candidate.tenantId,
        candidate.opportunityRecordId,
        candidate.followupVersion,
      ]);
      if (keys.has(key)) return true;
      keys.add(key);
    }
    return false;
  }

  private summarize(
    plannedCount: number,
    outcomes: StaleOpportunityReminderExecutionOutcome[],
  ): StaleOpportunityReminderExecutionSummary {
    return {
      plannedCount,
      processedCount: outcomes.length,
      sentCount: outcomes.filter(
        (outcome: StaleOpportunityReminderExecutionOutcome): boolean =>
          outcome.result.status === 'sent',
      ).length,
      skippedCount: outcomes.filter(
        (outcome: StaleOpportunityReminderExecutionOutcome): boolean =>
          outcome.result.status === 'skipped',
      ).length,
      failedCount: outcomes.filter(
        (outcome: StaleOpportunityReminderExecutionOutcome): boolean =>
          outcome.result.status === 'failed',
      ).length,
      remainingCount: plannedCount - outcomes.length,
    };
  }

  private empty(
    status: 'disabled' | 'blocked' | 'incomplete',
    now: Date,
    plan: StaleOpportunityReminderPlanResponse | null,
    warnings: string[] = [],
  ): StaleOpportunityReminderExecutionResult {
    const plannedCount: number = plan?.items.length ?? 0;
    return {
      status,
      generatedAt: now.toISOString(),
      plan,
      summary: {
        plannedCount,
        processedCount: 0,
        sentCount: 0,
        skippedCount: 0,
        failedCount: 0,
        remainingCount: plannedCount,
      },
      outcomes: [],
      warnings,
    };
  }
}

export { StaleOpportunityReminderExecutionService };
export type {
  StaleOpportunityReminderExecutionCoordinator,
  StaleOpportunityReminderExecutionInput,
  StaleOpportunityReminderExecutionItemResult,
  StaleOpportunityReminderExecutionOutcome,
  StaleOpportunityReminderExecutionPlanRunner,
  StaleOpportunityReminderExecutionResult,
  StaleOpportunityReminderExecutionSummary,
};
