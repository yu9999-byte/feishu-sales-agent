import { describe, expect, it, vi } from 'vitest';

import {
  ProactiveNotificationDeliveryService,
  RetryableProactiveNotificationError,
  type ProactiveNotificationStore,
} from '@server/modules/insight/proactive-notification-delivery.service';

const NOW: Date = new Date('2026-10-12T01:05:00.000Z');

const message = () => ({
  tenantId: '10000000-0000-4000-8000-00000000000a',
  recipientMemberId: '20000000-0000-4000-8000-00000000000a',
  recipientOpenId: 'ou_sales_a',
  kind: 'task_action' as const,
  notificationKey: '2026-10-12',
  subjectKey: 'task-digest',
  title: '今日任务行动提醒',
  subtitle: '3 个任务需要处理',
  sections: [{ title: '今日到期', lines: ['准备客户方案'] }],
  actionLabel: '查看任务履约',
  actionUrl: 'https://agent.example.com/tasks',
  payloadFingerprint: 'fingerprint-1',
});

const store = (): ProactiveNotificationStore => ({
  claim: vi.fn(async () => ({
    status: 'claimed' as const,
    claimToken: '30000000-0000-4000-8000-00000000000a',
    attemptCount: 1,
  })),
  markDispatchStarted: vi.fn(async () => true),
  markSent: vi.fn(async () => true),
  markFailed: vi.fn(async () => true),
  markDeliveryUnknown: vi.fn(async () => true),
});

describe('ProactiveNotificationDeliveryService', (): void => {
  it('does not claim or send while real delivery is disabled', async (): Promise<void> => {
    const persistence: ProactiveNotificationStore = store();
    const sender = { send: vi.fn() };

    await expect(new ProactiveNotificationDeliveryService(
      persistence,
      sender,
    ).deliver({ enabled: false, message: message(), now: NOW }))
      .resolves.toEqual({ status: 'skipped', reason: 'disabled' });
    expect(persistence.claim).not.toHaveBeenCalled();
    expect(sender.send).not.toHaveBeenCalled();
  });

  it('claims, marks dispatching and records one successful message', async (): Promise<void> => {
    const persistence: ProactiveNotificationStore = store();
    const sender = { send: vi.fn(async () => ({ messageId: 'om_1' })) };

    await expect(new ProactiveNotificationDeliveryService(
      persistence,
      sender,
    ).deliver({ enabled: true, message: message(), now: NOW }))
      .resolves.toEqual({
        status: 'sent',
        reason: 'delivered',
        messageId: 'om_1',
      });
    expect(persistence.markDispatchStarted).toHaveBeenCalledOnce();
    expect(persistence.markSent).toHaveBeenCalledWith(expect.objectContaining({
      messageId: 'om_1',
      sentAt: NOW,
    }));
  });

  it('does not send when another worker owns the same occurrence', async (): Promise<void> => {
    const persistence: ProactiveNotificationStore = {
      ...store(),
      claim: vi.fn(async () => ({ status: 'in_flight' as const })),
    };
    const sender = { send: vi.fn() };

    await expect(new ProactiveNotificationDeliveryService(
      persistence,
      sender,
    ).deliver({ enabled: true, message: message(), now: NOW }))
      .resolves.toEqual({ status: 'skipped', reason: 'in_flight' });
    expect(sender.send).not.toHaveBeenCalled();
  });

  it('retries explicit failures but freezes an unknown delivery', async (): Promise<void> => {
    const retryStore: ProactiveNotificationStore = store();
    const retrySender = {
      send: vi.fn(async (): Promise<never> => {
        throw new RetryableProactiveNotificationError('rejected');
      }),
    };
    const retryResult = await new ProactiveNotificationDeliveryService(
      retryStore,
      retrySender,
    ).deliver({ enabled: true, message: message(), now: NOW });
    expect(retryResult).toEqual({
      status: 'failed',
      reason: 'delivery_failed',
      retryAt: '2026-10-12T01:10:00.000Z',
    });
    expect(retryStore.markFailed).toHaveBeenCalledOnce();

    const unknownStore: ProactiveNotificationStore = store();
    const unknownSender = {
      send: vi.fn(async (): Promise<never> => {
        throw new Error('connection reset after write');
      }),
    };
    await expect(new ProactiveNotificationDeliveryService(
      unknownStore,
      unknownSender,
    ).deliver({ enabled: true, message: message(), now: NOW }))
      .resolves.toEqual({ status: 'failed', reason: 'delivery_unknown' });
    expect(unknownStore.markDeliveryUnknown).toHaveBeenCalledOnce();
    expect(unknownStore.markFailed).not.toHaveBeenCalled();
  });
});
