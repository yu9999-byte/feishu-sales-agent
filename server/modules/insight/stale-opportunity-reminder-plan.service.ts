import { Inject, Injectable } from '@nestjs/common';

import type {
  StaleOpportunityReminderPlanResponse,
  StaleOpportunityReminderPreflightResponse,
  StaleOpportunityTriggerResponse,
} from '@shared/api.interface';
import { StaleOpportunityReminderRuntimeService } from
  './stale-opportunity-reminder-runtime.service';
import { StaleOpportunityTriggerService } from
  './stale-opportunity-trigger.service';

interface StaleOpportunityReminderPlanInput {
  now?: Date;
  traceId?: string;
}

interface StaleOpportunityReminderPlanPreflightRunner {
  prepare(input?: { now?: Date }): Promise<
    StaleOpportunityReminderPreflightResponse
  >;
}

interface StaleOpportunityReminderPlanScanRunner {
  run(input?: {
    now?: Date;
    traceId?: string;
  }): Promise<StaleOpportunityTriggerResponse>;
}

@Injectable()
class StaleOpportunityReminderPlanService {
  constructor(
    @Inject(StaleOpportunityReminderRuntimeService)
    private readonly runtime: StaleOpportunityReminderPlanPreflightRunner,
    @Inject(StaleOpportunityTriggerService)
    private readonly trigger: StaleOpportunityReminderPlanScanRunner,
  ) {}

  async plan(
    input: StaleOpportunityReminderPlanInput = {},
  ): Promise<StaleOpportunityReminderPlanResponse> {
    const now: Date = input.now ?? new Date();
    const preflight: StaleOpportunityReminderPreflightResponse =
      await this.runtime.prepare({ now });
    if (preflight.status !== 'ready') {
      return this.empty(preflight.status, now, preflight);
    }

    let scan: StaleOpportunityTriggerResponse;
    try {
      scan = await this.trigger.run({
        now,
        traceId: input.traceId,
      });
    } catch (_error: unknown) {
      return {
        ...this.empty('incomplete', now, preflight),
        warnings: ['stale_opportunity_reminder_plan_scan_unavailable'],
      };
    }
    if (scan.status !== 'complete') {
      return {
        ...this.empty('incomplete', now, preflight),
        scanTraceId: scan.traceId,
        summary: {
          candidateCount: 0,
          suppressedCandidateCount:
            scan.summary.suppressedCandidateCount +
            scan.summary.candidateCount,
        },
        warnings: Array.from(new Set<string>([
          ...scan.warnings,
          'stale_opportunity_reminder_plan_incomplete',
        ])).sort(),
      };
    }

    return {
      mode: 'plan-only',
      status: 'ready',
      generatedAt: now.toISOString(),
      preflight,
      scanTraceId: scan.traceId,
      summary: {
        candidateCount: scan.candidates.length,
        suppressedCandidateCount: 0,
      },
      items: scan.candidates,
      warnings: scan.warnings,
    };
  }

  private empty(
    status: 'disabled' | 'blocked' | 'incomplete',
    now: Date,
    preflight: StaleOpportunityReminderPreflightResponse,
  ): StaleOpportunityReminderPlanResponse {
    return {
      mode: 'plan-only',
      status,
      generatedAt: now.toISOString(),
      preflight,
      scanTraceId: null,
      summary: {
        candidateCount: 0,
        suppressedCandidateCount: 0,
      },
      items: [],
      warnings: [],
    };
  }
}

export { StaleOpportunityReminderPlanService };
export type {
  StaleOpportunityReminderPlanInput,
  StaleOpportunityReminderPlanPreflightRunner,
  StaleOpportunityReminderPlanScanRunner,
};
