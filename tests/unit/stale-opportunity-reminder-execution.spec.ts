import { describe, expect, it, vi } from 'vitest';

import type {
  StaleOpportunityReminderPlanResponse,
  StaleOpportunityTriggerCandidate,
} from '@shared/api.interface';
import {
  StaleOpportunityReminderExecutionService,
} from '@server/modules/insight/stale-opportunity-reminder-execution.service';
import type {
  StaleOpportunityReminderPreparationResult,
} from '@server/modules/insight/stale-opportunity-reminder-coordinator.service';

const NOW: Date = new Date('2026-10-04T02:00:00.000Z');
const TRACE_ID: string = 'trace-reminder-execution';

const candidate = (
  opportunityRecordId: string,
): StaleOpportunityTriggerCandidate => ({
  tenantId: '00000000-0000-4000-8000-00000000000a',
  memberId: 'member-a',
  opportunityRecordId,
  opportunityName: `商机 ${opportunityRecordId}`,
  ownerOpenId: 'ou_sales_a',
  followupRecordId: `followup-${opportunityRecordId}`,
  lastEffectiveFollowupAt: '2026-09-20T02:00:00.000Z',
  followupVersion: `version-${opportunityRecordId}`,
});

const plan = (
  status: StaleOpportunityReminderPlanResponse['status'],
  items: StaleOpportunityTriggerCandidate[] = [],
): StaleOpportunityReminderPlanResponse => ({
  mode: 'plan-only',
  status,
  generatedAt: NOW.toISOString(),
  preflight: {
    status: status === 'ready' ? 'ready' : status === 'disabled'
      ? 'disabled'
      : 'blocked',
    checkedAt: NOW.toISOString(),
    reasons: status === 'blocked' ? ['history_governance_incomplete'] : [],
    uncertainDeliveryFound: false,
  },
  scanTraceId: status === 'ready' ? TRACE_ID : null,
  summary: {
    candidateCount: items.length,
    suppressedCandidateCount: 0,
  },
  items,
  warnings: [],
});

describe('StaleOpportunityReminderExecutionService', (): void => {
  it.each(['disabled', 'blocked', 'incomplete'] as const)(
    'does not recheck or claim a %s plan',
    async (status): Promise<void> => {
      const prepareAndDeliver = vi.fn();
      const service = new StaleOpportunityReminderExecutionService(
        { plan: vi.fn(async () => plan(status)) },
        { prepareAndDeliver },
      );

      await expect(service.execute({ now: NOW, traceId: TRACE_ID })).resolves
        .toMatchObject({
          status,
          summary: {
            plannedCount: 0,
            processedCount: 0,
            remainingCount: 0,
          },
          outcomes: [],
        });
      expect(prepareAndDeliver).not.toHaveBeenCalled();
    },
  );

  it('rechecks each ready candidate before delivery', async (): Promise<void> => {
    const items: StaleOpportunityTriggerCandidate[] = [
      candidate('opportunity-1'),
      candidate('opportunity-2'),
    ];
    const prepareAndDeliver = vi.fn(
      async (): Promise<StaleOpportunityReminderPreparationResult> => ({
        status: 'sent',
        reason: 'delivered',
        messageId: 'om_fake_reminder',
      }),
    );
    const service = new StaleOpportunityReminderExecutionService(
      { plan: vi.fn(async () => plan('ready', items)) },
      { prepareAndDeliver },
    );

    await expect(service.execute({ now: NOW, traceId: TRACE_ID })).resolves
      .toMatchObject({
        status: 'completed',
        summary: {
          plannedCount: 2,
          processedCount: 2,
          sentCount: 2,
          skippedCount: 0,
          failedCount: 0,
          remainingCount: 0,
        },
      });
    expect(prepareAndDeliver).toHaveBeenNthCalledWith(1, {
      enabled: true,
      tenantId: items[0].tenantId,
      memberId: items[0].memberId,
      evidence: {
        opportunityRecordId: items[0].opportunityRecordId,
        opportunityName: items[0].opportunityName,
        ownerOpenId: items[0].ownerOpenId,
        followupRecordId: items[0].followupRecordId,
        lastEffectiveFollowupAt: items[0].lastEffectiveFollowupAt,
        followupVersion: items[0].followupVersion,
      },
      now: NOW,
    });
    expect(prepareAndDeliver).toHaveBeenCalledTimes(2);
  });

  it('rejects duplicate plan evidence before any ledger claim', async (): Promise<void> => {
    const duplicate: StaleOpportunityTriggerCandidate = candidate(
      'opportunity-1',
    );
    const prepareAndDeliver = vi.fn();
    const service = new StaleOpportunityReminderExecutionService(
      { plan: vi.fn(async () => plan('ready', [duplicate, duplicate])) },
      { prepareAndDeliver },
    );

    await expect(service.execute({ now: NOW })).resolves.toMatchObject({
      status: 'incomplete',
      outcomes: [],
      warnings: ['stale_opportunity_reminder_execution_duplicate_candidate'],
    });
    expect(prepareAndDeliver).not.toHaveBeenCalled();
  });

  it('rejects an inconsistent ready plan before any ledger claim', async (): Promise<void> => {
    const item: StaleOpportunityTriggerCandidate = candidate(
      'opportunity-1',
    );
    const invalidPlan: StaleOpportunityReminderPlanResponse = plan(
      'ready',
      [item],
    );
    invalidPlan.summary.candidateCount = 2;
    const prepareAndDeliver = vi.fn();
    const service = new StaleOpportunityReminderExecutionService(
      { plan: vi.fn(async () => invalidPlan) },
      { prepareAndDeliver },
    );

    await expect(service.execute({ now: NOW })).resolves.toMatchObject({
      status: 'incomplete',
      outcomes: [],
      warnings: ['stale_opportunity_reminder_execution_invalid_plan'],
    });
    expect(prepareAndDeliver).not.toHaveBeenCalled();
  });

  it.each(['source_unverified', 'tenant_unavailable'] as const)(
    'halts the batch when current evidence returns %s',
    async (reason): Promise<void> => {
    const items: StaleOpportunityTriggerCandidate[] = [
      candidate('opportunity-1'),
      candidate('opportunity-2'),
    ];
    const prepareAndDeliver = vi.fn(
      async (): Promise<StaleOpportunityReminderPreparationResult> => ({
        status: 'skipped',
        reason,
      }),
    );
    const service = new StaleOpportunityReminderExecutionService(
      { plan: vi.fn(async () => plan('ready', items)) },
      { prepareAndDeliver },
    );

    await expect(service.execute({ now: NOW })).resolves.toMatchObject({
      status: 'halted',
      summary: {
        plannedCount: 2,
        processedCount: 1,
        skippedCount: 1,
        remainingCount: 1,
      },
      warnings: ['stale_opportunity_reminder_execution_halted'],
    });
    expect(prepareAndDeliver).toHaveBeenCalledTimes(1);
    },
  );

  it('keeps a one-item unknown delivery batch halted', async (): Promise<void> => {
    const item: StaleOpportunityTriggerCandidate = candidate(
      'opportunity-1',
    );
    const prepareAndDeliver = vi.fn(
      async (): Promise<StaleOpportunityReminderPreparationResult> => ({
        status: 'failed',
        reason: 'delivery_unknown',
      }),
    );
    const service = new StaleOpportunityReminderExecutionService(
      { plan: vi.fn(async () => plan('ready', [item])) },
      { prepareAndDeliver },
    );

    await expect(service.execute({ now: NOW })).resolves.toMatchObject({
      status: 'halted',
      summary: {
        plannedCount: 1,
        processedCount: 1,
        failedCount: 1,
        remainingCount: 0,
      },
      warnings: ['stale_opportunity_reminder_execution_halted'],
    });
  });

  it('fails closed when the coordinator throws unexpectedly', async (): Promise<void> => {
    const items: StaleOpportunityTriggerCandidate[] = [
      candidate('opportunity-1'),
      candidate('opportunity-2'),
    ];
    const prepareAndDeliver = vi.fn(async () => {
      throw new Error('ledger unavailable');
    });
    const service = new StaleOpportunityReminderExecutionService(
      { plan: vi.fn(async () => plan('ready', items)) },
      { prepareAndDeliver },
    );

    await expect(service.execute({ now: NOW })).resolves.toMatchObject({
      status: 'halted',
      summary: {
        plannedCount: 2,
        processedCount: 1,
        failedCount: 1,
        remainingCount: 1,
      },
      outcomes: [{
        candidate: items[0],
        result: { status: 'failed', reason: 'execution_unavailable' },
      }],
      warnings: [
        'stale_opportunity_reminder_execution_halted',
        'stale_opportunity_reminder_execution_unavailable',
      ],
    });
    expect(prepareAndDeliver).toHaveBeenCalledTimes(1);
  });
});
