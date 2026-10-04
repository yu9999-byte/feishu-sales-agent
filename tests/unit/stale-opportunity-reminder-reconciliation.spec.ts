import { describe, expect, it, vi } from 'vitest';

import {
  StaleOpportunityReminderReconciliationError,
  StaleOpportunityReminderReconciliationService,
} from '@server/modules/insight/stale-opportunity-reminder-reconciliation.service';
import type {
  StaleOpportunityReminderReconcileInput,
  StaleOpportunityReminderReconcileResult,
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

  it('confirms a sent reminder with operator evidence', async (): Promise<void> => {
    const reconcile = vi.fn(
      async (
        _input: StaleOpportunityReminderReconcileInput,
      ): Promise<StaleOpportunityReminderReconcileResult> => ({
        status: 'reconciled',
        reconciliationId: '20000000-0000-4000-8000-000000000001',
        previousStatus: 'uncertain',
        currentStatus: 'sent',
        updatedAt: new Date('2026-09-29T03:00:00.000Z'),
      }),
    );
    const service = new StaleOpportunityReminderReconciliationService(
      { listUncertain: vi.fn(async () => []) },
      { reconcile },
    );

    await expect(service.reconcile({
      tenantId: item.tenantId,
      operatorMemberId: '30000000-0000-4000-8000-000000000001',
      opportunityRecordId: item.opportunityRecordId,
      followupVersion: item.followupVersion,
      reminderKind: item.reminderKind,
      expectedUpdatedAt: item.updatedAt,
      decision: 'confirm_sent',
      note: '已在飞书消息记录中核对发送成功',
      messageId: 'om_verified_reminder',
      sentAt: '2026-09-29T02:00:01.000Z',
      now: new Date('2026-09-29T03:00:00.000Z'),
    })).resolves.toEqual({
      reconciliationId: '20000000-0000-4000-8000-000000000001',
      opportunityRecordId: item.opportunityRecordId,
      followupVersion: item.followupVersion,
      reminderKind: item.reminderKind,
      decision: 'confirm_sent',
      previousStatus: 'uncertain',
      currentStatus: 'sent',
      updatedAt: '2026-09-29T03:00:00.000Z',
    });
    expect(reconcile).toHaveBeenCalledWith(expect.objectContaining({
      tenantId: item.tenantId,
      operatorMemberId: '30000000-0000-4000-8000-000000000001',
      note: '已在飞书消息记录中核对发送成功',
      messageId: 'om_verified_reminder',
      sentAt: new Date('2026-09-29T02:00:01.000Z'),
    }));
  });

  it.each([
    {
      decision: 'confirm_sent' as const,
      messageId: undefined,
      sentAt: undefined,
    },
    {
      decision: 'authorize_retry' as const,
      messageId: 'om_not_allowed',
      sentAt: undefined,
    },
    {
      decision: 'keep_frozen' as const,
      messageId: undefined,
      sentAt: '2026-09-29T02:00:01.000Z',
    },
  ])('rejects evidence that does not match $decision', async (evidence): Promise<void> => {
    const reconcile = vi.fn();
    const service = new StaleOpportunityReminderReconciliationService(
      { listUncertain: vi.fn(async () => []) },
      { reconcile },
    );

    await expect(service.reconcile({
      tenantId: item.tenantId,
      operatorMemberId: '30000000-0000-4000-8000-000000000001',
      opportunityRecordId: item.opportunityRecordId,
      followupVersion: item.followupVersion,
      reminderKind: item.reminderKind,
      expectedUpdatedAt: item.updatedAt,
      decision: evidence.decision,
      note: '人工核对证据说明完整',
      messageId: evidence.messageId,
      sentAt: evidence.sentAt,
      now: new Date('2026-09-29T03:00:00.000Z'),
    })).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    expect(reconcile).not.toHaveBeenCalled();
  });

  it('surfaces optimistic concurrency evidence without retrying', async (): Promise<void> => {
    const reconcile = vi.fn(
      async (): Promise<StaleOpportunityReminderReconcileResult> => ({
        status: 'conflict',
        currentStatus: 'sent',
        currentUpdatedAt: new Date('2026-09-29T03:00:00.000Z'),
      }),
    );
    const service = new StaleOpportunityReminderReconciliationService(
      { listUncertain: vi.fn(async () => []) },
      { reconcile },
    );

    const promise: Promise<unknown> = service.reconcile({
      tenantId: item.tenantId,
      operatorMemberId: '30000000-0000-4000-8000-000000000001',
      opportunityRecordId: item.opportunityRecordId,
      followupVersion: item.followupVersion,
      reminderKind: item.reminderKind,
      expectedUpdatedAt: item.updatedAt,
      decision: 'authorize_retry',
      note: '确认没有发送，允许重新尝试',
      now: new Date('2026-09-29T03:00:00.000Z'),
    });

    await expect(promise).rejects.toEqual(expect.objectContaining({
      code: 'CONFLICT',
      currentStatus: 'sent',
      currentUpdatedAt: '2026-09-29T03:00:00.000Z',
    }));
    await expect(promise).rejects.toBeInstanceOf(
      StaleOpportunityReminderReconciliationError,
    );
    expect(reconcile).toHaveBeenCalledTimes(1);
  });
});
