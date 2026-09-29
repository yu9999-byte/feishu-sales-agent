import { describe, expect, it, vi } from 'vitest';

import type {
  StaleOpportunityReminderSender,
  StaleOpportunityReminderStore,
} from '@server/modules/insight/stale-opportunity-reminder.service';
import {
  RetryableStaleOpportunityReminderError,
  StaleOpportunityReminderService,
} from '@server/modules/insight/stale-opportunity-reminder.service';

const NOW: Date = new Date('2026-09-29T02:00:00.000Z');

const input = () => ({
  enabled: true,
  tenantId: '10000000-0000-4000-8000-00000000000a',
  recipientOpenId: 'ou_sales_a',
  evidence: {
    opportunityRecordId: 'opportunity-1',
    opportunityName: '北辰数字化项目',
    ownerOpenId: 'ou_sales_a',
    followupRecordId: 'followup-1',
    lastEffectiveFollowupAt: '2026-09-20T02:00:00.000Z',
    followupVersion: '2026-09-20T02:00:00.000Z',
  },
  now: NOW,
});

describe('StaleOpportunityReminderService', (): void => {
  it('is disabled by default, before claiming or sending', async (): Promise<void> => {
    const claim = vi.fn();
    const send = vi.fn();
    const service = new StaleOpportunityReminderService({
      claim,
      markDispatchStarted: vi.fn(),
      markSent: vi.fn(),
      markFailed: vi.fn(),
      markDeliveryUnknown: vi.fn(),
    }, { send });

    await expect(service.deliver({ ...input(), enabled: false }))
      .resolves.toEqual({ status: 'skipped', reason: 'disabled' });
    expect(claim).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });

  it('rejects unverified or non-stale followup time', async (): Promise<void> => {
    const claim = vi.fn();
    const send = vi.fn();
    const service = new StaleOpportunityReminderService({
      claim,
      markDispatchStarted: vi.fn(),
      markSent: vi.fn(),
      markFailed: vi.fn(),
      markDeliveryUnknown: vi.fn(),
    }, { send });
    for (const lastEffectiveFollowupAt of [
      '2026-09-20T02:00:00',
      '2026-09-22T02:00:00.000Z',
      '2026-09-30T02:00:00.000Z',
    ]) {
      await expect(service.deliver({
        ...input(),
        evidence: { ...input().evidence, lastEffectiveFollowupAt },
      })).resolves.toEqual({ status: 'skipped', reason: 'invalid_evidence' });
    }
    expect(claim).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });

  it('sends once after an atomic claim and records the message', async (): Promise<void> => {
    const claim = vi.fn(async () => ({
      status: 'claimed' as const,
      claimToken: 'claim-1',
      attemptCount: 1,
    }));
    const markSent = vi.fn(async () => true);
    const store: StaleOpportunityReminderStore = {
      claim,
      markDispatchStarted: vi.fn(async () => true),
      markSent,
      markFailed: vi.fn(async () => true),
      markDeliveryUnknown: vi.fn(async () => true),
    };
    const sender: StaleOpportunityReminderSender = {
      send: vi.fn(async () => ({ messageId: 'om_reminder_1' })),
    };

    const result = await new StaleOpportunityReminderService(store, sender)
      .deliver(input());

    expect(result).toEqual({
      status: 'sent',
      reason: 'delivered',
      messageId: 'om_reminder_1',
    });
    expect(sender.send).toHaveBeenCalledWith({
      recipientOpenId: 'ou_sales_a',
      opportunityRecordId: 'opportunity-1',
      opportunityName: '北辰数字化项目',
      followupRecordId: 'followup-1',
      lastEffectiveFollowupAt: '2026-09-20T02:00:00.000Z',
      suggestedAction: '核对客户进展并确认下一步跟进安排',
    });
    expect(markSent).toHaveBeenCalledWith(expect.objectContaining({
      claimToken: 'claim-1',
      messageId: 'om_reminder_1',
      sentAt: NOW,
    }));
  });

  it('does not call the sender while the same version is cooling down', async (): Promise<void> => {
    const store: StaleOpportunityReminderStore = {
      claim: vi.fn(async () => ({
        status: 'cooling_down' as const,
        retryAt: new Date('2026-10-05T02:00:00.000Z'),
      })),
      markDispatchStarted: vi.fn(async () => true),
      markSent: vi.fn(async () => true),
      markFailed: vi.fn(async () => true),
      markDeliveryUnknown: vi.fn(async () => true),
    };
    const send = vi.fn();

    const result = await new StaleOpportunityReminderService(
      store,
      { send },
    ).deliver(input());

    expect(result).toEqual({
      status: 'skipped',
      reason: 'cooling_down',
      retryAt: '2026-10-05T02:00:00.000Z',
    });
    expect(send).not.toHaveBeenCalled();
  });

  it('records a retry window when delivery fails', async (): Promise<void> => {
    const markFailed = vi.fn(async () => true);
    const store: StaleOpportunityReminderStore = {
      claim: vi.fn(async () => ({
        status: 'claimed' as const,
        claimToken: 'claim-2',
        attemptCount: 2,
      })),
      markDispatchStarted: vi.fn(async () => true),
      markSent: vi.fn(async () => true),
      markFailed,
      markDeliveryUnknown: vi.fn(async () => true),
    };
    const sender: StaleOpportunityReminderSender = {
      send: vi.fn(async (): Promise<never> => {
        throw new RetryableStaleOpportunityReminderError(
          'Feishu unavailable',
        );
      }),
    };

    const result = await new StaleOpportunityReminderService(store, sender)
      .deliver(input());

    expect(result).toEqual({
      status: 'failed',
      reason: 'delivery_failed',
      retryAt: '2026-09-29T02:15:00.000Z',
    });
    expect(markFailed).toHaveBeenCalledWith(expect.objectContaining({
      claimToken: 'claim-2',
      failedAt: NOW,
      retryAt: new Date('2026-09-29T02:15:00.000Z'),
      failureCode: 'REMINDER_DELIVERY_FAILED',
    }));
  });

  it('rejects a recipient that no longer owns the opportunity', async (): Promise<void> => {
    const claim = vi.fn();
    const sender: StaleOpportunityReminderSender = { send: vi.fn() };
    const service = new StaleOpportunityReminderService({
      claim,
      markDispatchStarted: vi.fn(async () => true),
      markSent: vi.fn(async () => true),
      markFailed: vi.fn(async () => true),
      markDeliveryUnknown: vi.fn(async () => true),
    }, sender);

    const result = await service.deliver({
      ...input(),
      recipientOpenId: 'ou_other_sales',
    });

    expect(result).toEqual({
      status: 'skipped',
      reason: 'owner_mismatch',
    });
    expect(claim).not.toHaveBeenCalled();
    expect(sender.send).not.toHaveBeenCalled();
  });

  it('stops automatic retries when delivery outcome is unknown', async (): Promise<void> => {
    const markFailed = vi.fn(async () => true);
    const markDeliveryUnknown = vi.fn(async () => true);
    const service = new StaleOpportunityReminderService({
      claim: vi.fn(async () => ({
        status: 'claimed' as const,
        claimToken: 'claim-unknown',
        attemptCount: 1,
      })),
      markDispatchStarted: vi.fn(async () => true),
      markSent: vi.fn(async () => true),
      markFailed,
      markDeliveryUnknown,
    }, {
      send: vi.fn(async (): Promise<never> => {
        throw new Error('Network timeout after request write');
      }),
    });

    await expect(service.deliver(input())).resolves.toEqual({
      status: 'failed',
      reason: 'delivery_unknown',
    });
    expect(markFailed).not.toHaveBeenCalled();
    expect(markDeliveryUnknown).toHaveBeenCalledWith(
      expect.objectContaining({
        claimToken: 'claim-unknown',
        failureCode: 'REMINDER_DELIVERY_UNKNOWN',
      }),
    );
  });

  it('never reclassifies a sent message as retryable when finalization fails', async (): Promise<void> => {
    const markFailed = vi.fn();
    const markDeliveryUnknown = vi.fn();
    const service = new StaleOpportunityReminderService({
      claim: vi.fn(async () => ({
        status: 'claimed' as const,
        claimToken: 'claim-finalization',
        attemptCount: 1,
      })),
      markDispatchStarted: vi.fn(async () => true),
      markSent: vi.fn(async (): Promise<never> => {
        throw new Error('Database unavailable');
      }),
      markFailed,
      markDeliveryUnknown,
    }, { send: vi.fn(async () => ({ messageId: 'om_sent' })) });

    await expect(service.deliver(input())).resolves.toEqual({
      status: 'failed',
      reason: 'delivery_unknown',
    });
    expect(markFailed).not.toHaveBeenCalled();
    expect(markDeliveryUnknown).not.toHaveBeenCalled();
  });
});
