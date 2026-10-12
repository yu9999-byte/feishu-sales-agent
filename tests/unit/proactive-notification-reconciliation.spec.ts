import { describe, expect, it, vi } from 'vitest';

import {
  ProactiveNotificationReconciliationError,
  ProactiveNotificationReconciliationService,
} from '@server/modules/insight/proactive-notification-reconciliation.service';
import type {
  ProactiveNotificationReconcileInput,
  ProactiveNotificationReconcileResult,
  ProactiveNotificationUncertainRecord,
} from '@server/modules/insight/proactive-notification-reconciliation.service';

const TENANT_ID: string = '10000000-0000-4000-8000-000000000031';
const MEMBER_ID: string = '20000000-0000-4000-8000-000000000031';
const NOTIFICATION_ID: string = '30000000-0000-4000-8000-000000000031';
const OPERATOR_ID: string = '40000000-0000-4000-8000-000000000031';
const UPDATED_AT: string = '2026-10-12T10:05:00.000Z';
const NOW: Date = new Date('2026-10-13T01:00:00.000Z');

const item: ProactiveNotificationUncertainRecord = {
  notificationId: NOTIFICATION_ID,
  tenantId: TENANT_ID,
  recipientMemberId: MEMBER_ID,
  recipientDisplayName: '销售 A',
  kind: 'daily_report',
  notificationKey: '2026-10-12',
  subjectKey: '2026-10-12',
  attemptCount: 1,
  dispatchStartedAt: '2026-10-12T10:04:59.000Z',
  failureCode: 'PROACTIVE_DELIVERY_UNKNOWN',
  failureMessage: 'Network outcome not verified',
  updatedAt: UPDATED_AT,
};

describe('ProactiveNotificationReconciliationService', (): void => {
  it('lists only the requested tenant without mutating delivery state', async (): Promise<void> => {
    const listUncertain = vi.fn(async () => [item]);
    const service = new ProactiveNotificationReconciliationService({
      listUncertain,
      reconcile: vi.fn(),
    });

    await expect(service.listUncertain({
      tenantId: TENANT_ID,
      limit: 25,
    })).resolves.toEqual({
      status: 'ready',
      items: [{
        notificationId: item.notificationId,
        recipientMemberId: item.recipientMemberId,
        recipientDisplayName: item.recipientDisplayName,
        kind: item.kind,
        notificationKey: item.notificationKey,
        subjectKey: item.subjectKey,
        attemptCount: item.attemptCount,
        dispatchStartedAt: item.dispatchStartedAt,
        failureCode: item.failureCode,
        failureMessage: item.failureMessage,
        updatedAt: item.updatedAt,
      }],
      warnings: [],
    });
    expect(listUncertain).toHaveBeenCalledWith({
      tenantId: TENANT_ID,
      limit: 25,
    });
  });

  it.each([0, 101, 1.5])(
    'rejects invalid list limit before reading (%s)',
    async (limit: number): Promise<void> => {
      const listUncertain = vi.fn();
      const service = new ProactiveNotificationReconciliationService({
        listUncertain,
        reconcile: vi.fn(),
      });

      await expect(service.listUncertain({
        tenantId: TENANT_ID,
        limit,
      })).resolves.toEqual({
        status: 'unavailable',
        items: [],
        warnings: ['proactive_reconciliation_limit_invalid'],
      });
      expect(listUncertain).not.toHaveBeenCalled();
    },
  );

  it('confirms a delivered notification with message evidence', async (): Promise<void> => {
    const reconcile = vi.fn(
      async (
        _input: ProactiveNotificationReconcileInput,
      ): Promise<ProactiveNotificationReconcileResult> => ({
        status: 'reconciled',
        reconciliationId: '50000000-0000-4000-8000-000000000031',
        previousStatus: 'uncertain',
        currentStatus: 'sent',
        updatedAt: NOW,
      }),
    );
    const service = new ProactiveNotificationReconciliationService({
      listUncertain: vi.fn(async () => []),
      reconcile,
    });

    await expect(service.reconcile({
      tenantId: TENANT_ID,
      operatorMemberId: OPERATOR_ID,
      notificationId: NOTIFICATION_ID,
      expectedUpdatedAt: UPDATED_AT,
      decision: 'confirm_sent',
      note: '已在飞书消息记录中核对为送达',
      messageId: 'om_verified_proactive',
      sentAt: '2026-10-12T10:05:01.000Z',
      now: NOW,
    })).resolves.toEqual({
      reconciliationId: '50000000-0000-4000-8000-000000000031',
      notificationId: NOTIFICATION_ID,
      decision: 'confirm_sent',
      previousStatus: 'uncertain',
      currentStatus: 'sent',
      updatedAt: NOW.toISOString(),
    });
    expect(reconcile).toHaveBeenCalledWith(expect.objectContaining({
      tenantId: TENANT_ID,
      operatorMemberId: OPERATOR_ID,
      notificationId: NOTIFICATION_ID,
      messageId: 'om_verified_proactive',
      sentAt: new Date('2026-10-12T10:05:01.000Z'),
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
      sentAt: '2026-10-12T10:05:01.000Z',
    },
  ])(
    'rejects evidence that does not match $decision',
    async (evidence): Promise<void> => {
      const reconcile = vi.fn();
      const service = new ProactiveNotificationReconciliationService({
        listUncertain: vi.fn(async () => []),
        reconcile,
      });

      await expect(service.reconcile({
        tenantId: TENANT_ID,
        operatorMemberId: OPERATOR_ID,
        notificationId: NOTIFICATION_ID,
        expectedUpdatedAt: UPDATED_AT,
        decision: evidence.decision,
        note: '人工核对证据说明完整',
        messageId: evidence.messageId,
        sentAt: evidence.sentAt,
        now: NOW,
      })).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
      expect(reconcile).not.toHaveBeenCalled();
    },
  );

  it('surfaces optimistic concurrency conflicts without retrying', async (): Promise<void> => {
    const reconcile = vi.fn(
      async (): Promise<ProactiveNotificationReconcileResult> => ({
        status: 'conflict',
        currentStatus: 'sent',
        currentUpdatedAt: NOW,
      }),
    );
    const service = new ProactiveNotificationReconciliationService({
      listUncertain: vi.fn(async () => []),
      reconcile,
    });

    const result: Promise<unknown> = service.reconcile({
      tenantId: TENANT_ID,
      operatorMemberId: OPERATOR_ID,
      notificationId: NOTIFICATION_ID,
      expectedUpdatedAt: UPDATED_AT,
      decision: 'authorize_retry',
      note: '确认未送达，仅释放一次重试',
      now: NOW,
    });

    await expect(result).rejects.toEqual(expect.objectContaining({
      code: 'CONFLICT',
      currentStatus: 'sent',
      currentUpdatedAt: NOW.toISOString(),
    }));
    await expect(result).rejects.toBeInstanceOf(
      ProactiveNotificationReconciliationError,
    );
    expect(reconcile).toHaveBeenCalledTimes(1);
  });
});
