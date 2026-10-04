import { describe, expect, it, vi } from 'vitest';

import {
  StaleOpportunityReminderReconciliationService,
} from '@server/modules/insight/stale-opportunity-reminder-reconciliation.service';
import type {
  StaleOpportunityReminderUncertainRecord,
} from '@server/modules/insight/stale-opportunity-reminder.service';

const item: StaleOpportunityReminderUncertainRecord = {
  tenantId: '10000000-0000-4000-8000-00000000000a',
  opportunityRecordId: 'opportunity-1',
  followupVersion: 'followup-version-1',
  reminderKind: 'stale_followup',
  opportunityName: '北辰数字化项目',
  ownerOpenId: 'ou_sales_a',
  attemptCount: 1,
  dispatchStartedAt: '2026-09-29T02:00:00.000Z',
  failureCode: 'REMINDER_DELIVERY_UNKNOWN',
  failureMessage: 'Network outcome not verified',
  updatedAt: '2026-09-29T02:00:00.000Z',
};

describe('StaleOpportunityReminderReconciliationService', (): void => {
  it('lists uncertain records without mutating the reader', async (): Promise<void> => {
    const listUncertain = vi.fn(async () => [item]);
    const service = new StaleOpportunityReminderReconciliationService({
      listUncertain,
    });

    await expect(service.listUncertain({
      tenantId: item.tenantId,
      limit: 10,
    })).resolves.toEqual({
      status: 'ready',
      items: [item],
      warnings: [],
    });
    expect(listUncertain).toHaveBeenCalledWith({
      tenantId: item.tenantId,
      limit: 10,
    });
  });

  it.each([
    0,
    101,
    1.5,
  ])('rejects an invalid limit before reading (%s)', async (limit: number): Promise<void> => {
    const listUncertain = vi.fn();
    const service = new StaleOpportunityReminderReconciliationService({
      listUncertain,
    });

    await expect(service.listUncertain({ limit })).resolves.toEqual({
      status: 'unavailable',
      items: [],
      warnings: ['reconciliation_limit_invalid'],
    });
    expect(listUncertain).not.toHaveBeenCalled();
  });

  it('fails closed when the ledger reader is unavailable', async (): Promise<void> => {
    const service = new StaleOpportunityReminderReconciliationService({
      listUncertain: vi.fn(async (): Promise<StaleOpportunityReminderUncertainRecord[]> => {
        throw new Error('database unavailable');
      }),
    });

    await expect(service.listUncertain()).resolves.toEqual({
      status: 'unavailable',
      items: [],
      warnings: ['reconciliation_source_unavailable'],
    });
  });
});
