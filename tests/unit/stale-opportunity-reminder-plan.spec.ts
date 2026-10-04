import { MODULE_METADATA } from '@nestjs/common/constants';
import { describe, expect, it, vi } from 'vitest';

import type {
  StaleOpportunityReminderPreflightResponse,
  StaleOpportunityTriggerResponse,
} from '@shared/api.interface';
import {
  StaleOpportunityReminderPlanService,
} from '@server/modules/insight/stale-opportunity-reminder-plan.service';
import {
  StaleOpportunityReadinessModule,
} from '@server/modules/insight/stale-opportunity-readiness.module';

const NOW: Date = new Date('2026-10-04T02:00:00.000Z');
const TRACE_ID: string = 'trace-reminder-plan';

const preflight = (
  status: StaleOpportunityReminderPreflightResponse['status'],
): StaleOpportunityReminderPreflightResponse => ({
  status,
  checkedAt: NOW.toISOString(),
  reasons: status === 'blocked' ? ['history_governance_incomplete'] : [],
  uncertainDeliveryFound: false,
});

const scan = (
  status: StaleOpportunityTriggerResponse['status'],
): StaleOpportunityTriggerResponse => ({
  traceId: TRACE_ID,
  generatedAt: NOW.toISOString(),
  mode: 'dry-run',
  status,
  summary: {
    tenantCount: 1,
    memberCount: 1,
    scannedMemberCount: 1,
    skippedMemberCount: 0,
    incompleteMemberCount: status === 'incomplete' ? 1 : 0,
    candidateCount: status === 'complete' ? 1 : 0,
    suppressedCandidateCount: status === 'incomplete' ? 1 : 0,
    skipCount: status === 'incomplete' ? 1 : 0,
  },
  candidates: status === 'complete'
    ? [{
        tenantId: '00000000-0000-4000-8000-00000000000a',
        memberId: 'member-a',
        opportunityRecordId: 'opportunity-1',
        opportunityName: '北辰数字化项目',
        ownerOpenId: 'ou_sales_a',
        followupRecordId: 'followup-1',
        lastEffectiveFollowupAt: '2026-09-20T02:00:00.000Z',
        followupVersion: 'followup-v1',
      }]
    : [],
  skips: status === 'incomplete'
    ? [{
        tenantId: null,
        memberId: null,
        opportunityRecordId: null,
        opportunityName: null,
        reason: 'source_unverified',
      }]
    : [],
  audit: [],
  warnings: status === 'incomplete'
    ? ['stale_opportunity_batch_incomplete']
    : [],
});

describe('StaleOpportunityReminderPlanService', (): void => {
  it('registers the plan service in the insight module', (): void => {
    const providers: unknown = Reflect.getMetadata(
      MODULE_METADATA.PROVIDERS,
      StaleOpportunityReadinessModule,
    );

    expect(providers).toEqual(expect.arrayContaining([
      StaleOpportunityReminderPlanService,
    ]));
  });

  it.each(['disabled', 'blocked'] as const)(
    'returns an empty %s plan without scanning',
    async (status): Promise<void> => {
      const prepare = vi.fn(async () => preflight(status));
      const run = vi.fn();
      const service = new StaleOpportunityReminderPlanService(
        { prepare },
        { run },
      );

      await expect(service.plan({ now: NOW, traceId: TRACE_ID })).resolves
        .toEqual({
          mode: 'plan-only',
          status,
          generatedAt: NOW.toISOString(),
          preflight: preflight(status),
          scanTraceId: null,
          summary: { candidateCount: 0, suppressedCandidateCount: 0 },
          items: [],
          warnings: [],
        });
      expect(run).not.toHaveBeenCalled();
    },
  );

  it('suppresses the complete plan when the dry scan is incomplete', async (): Promise<void> => {
    const prepare = vi.fn(async () => preflight('ready'));
    const run = vi.fn(async () => scan('incomplete'));
    const service = new StaleOpportunityReminderPlanService(
      { prepare },
      { run },
    );

    await expect(service.plan({ now: NOW, traceId: TRACE_ID })).resolves
      .toMatchObject({
        mode: 'plan-only',
        status: 'incomplete',
        scanTraceId: TRACE_ID,
        summary: { candidateCount: 0, suppressedCandidateCount: 1 },
        items: [],
        warnings: [
          'stale_opportunity_batch_incomplete',
          'stale_opportunity_reminder_plan_incomplete',
        ],
      });
  });

  it('fails closed when the dry scan throws unexpectedly', async (): Promise<void> => {
    const prepare = vi.fn(async () => preflight('ready'));
    const run = vi.fn(async (): Promise<StaleOpportunityTriggerResponse> => {
      throw new Error('scan unavailable');
    });
    const service = new StaleOpportunityReminderPlanService(
      { prepare },
      { run },
    );

    await expect(service.plan({ now: NOW, traceId: TRACE_ID })).resolves
      .toMatchObject({
        mode: 'plan-only',
        status: 'incomplete',
        scanTraceId: null,
        summary: { candidateCount: 0, suppressedCandidateCount: 0 },
        items: [],
        warnings: ['stale_opportunity_reminder_plan_scan_unavailable'],
      });
  });

  it('returns evidence-rich plan items without delivering them', async (): Promise<void> => {
    const prepare = vi.fn(async () => preflight('ready'));
    const triggerResult: StaleOpportunityTriggerResponse = scan('complete');
    const run = vi.fn(async () => triggerResult);
    const service = new StaleOpportunityReminderPlanService(
      { prepare },
      { run },
    );

    await expect(service.plan({ now: NOW, traceId: TRACE_ID })).resolves
      .toEqual({
        mode: 'plan-only',
        status: 'ready',
        generatedAt: NOW.toISOString(),
        preflight: preflight('ready'),
        scanTraceId: TRACE_ID,
        summary: { candidateCount: 1, suppressedCandidateCount: 0 },
        items: triggerResult.candidates,
        warnings: [],
      });
    expect(run).toHaveBeenCalledWith({ now: NOW, traceId: TRACE_ID });
  });
});
