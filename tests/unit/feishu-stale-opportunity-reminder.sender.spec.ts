import { createHash } from 'node:crypto';

import { describe, expect, it, vi } from 'vitest';

import type {
  TenantIntegration,
} from '@server/modules/agent-core/agent.types';
import type {
  FeishuClientFactory,
} from '@server/modules/feishu/feishu-client.factory';
import {
  FeishuStaleOpportunityReminderSender,
} from '@server/modules/feishu/feishu-stale-opportunity-reminder.sender';
import {
  RetryableStaleOpportunityReminderError,
  StaleOpportunityReminderService,
} from '@server/modules/insight/stale-opportunity-reminder.service';
import type {
  StaleOpportunityReminderMessage,
  StaleOpportunityReminderStore,
} from '@server/modules/insight/stale-opportunity-reminder.service';

const TENANT_ID: string = '10000000-0000-4000-8000-00000000000a';
const NOW: Date = new Date('2026-09-29T02:00:00.000Z');

const integration = (
  overrides: Partial<TenantIntegration> = {},
): TenantIntegration => ({
  tenantId: TENANT_ID,
  feishuTenantKey: 'tenant-a',
  name: 'tenant-a',
  status: 'active',
  appId: 'cli_test',
  appSecretEnv: 'TEST_APP_SECRET',
  appType: 'selfBuild',
  base: {
    appToken: 'base_test',
    customers: {
      tableId: 'tbl_customers',
      primaryField: '客户名称',
      fields: { customerName: '客户名称' },
    },
    opportunities: {
      tableId: 'tbl_opportunities',
      primaryField: '商机名称',
      fields: {
        opportunityName: '商机名称',
        customerLink: '关联客户',
      },
    },
    followups: {
      tableId: 'tbl_followups',
      primaryField: '跟进标题',
      fields: {
        sourceMessageId: '来源消息ID',
        customerLink: '关联客户',
        opportunityLink: '关联商机',
        rawText: '原文',
        summary: '摘要',
      },
    },
  },
  ...overrides,
});

const message = (
  overrides: Partial<StaleOpportunityReminderMessage> = {},
): StaleOpportunityReminderMessage => ({
  tenantId: TENANT_ID,
  recipientOpenId: 'ou_sales_a',
  opportunityRecordId: 'opportunity-1',
  opportunityName: '北辰数字化项目',
  followupRecordId: 'followup-1',
  lastEffectiveFollowupAt: '2026-09-20T02:00:00.000Z',
  suggestedAction: '核对客户进展并确认下一步跟进安排',
  idempotencyKey: `${TENANT_ID}:stale_followup:opportunity-1:version-1`,
  ...overrides,
});

interface SenderHarness {
  sender: FeishuStaleOpportunityReminderSender;
  createMessage: ReturnType<typeof vi.fn>;
  resolveTenantById: ReturnType<typeof vi.fn>;
  requestOptions: { headers: Record<string, string> };
}

const harness = (
  response: unknown = {
    code: 0,
    msg: 'ok',
    data: { message_id: 'om_reminder_1' },
  },
): SenderHarness => {
  const createMessage = vi.fn(async () => response);
  const resolveTenantById = vi.fn(async () => integration());
  const requestOptions: { headers: Record<string, string> } = {
    headers: { 'x-test-tenant': 'tenant-a' },
  };
  const clients = {
    getClient: (): unknown => ({
      im: { message: { create: createMessage } },
    }),
    getRequestOptions: (): unknown => requestOptions,
  } as unknown as FeishuClientFactory;
  return {
    sender: new FeishuStaleOpportunityReminderSender(
      { resolveTenantById },
      clients,
    ),
    createMessage,
    resolveTenantById,
    requestOptions,
  };
};

const reminderStore = (): StaleOpportunityReminderStore => ({
  claim: vi.fn(async () => ({
    status: 'claimed' as const,
    claimToken: 'claim-adapter-1',
    attemptCount: 1,
  })),
  markDispatchStarted: vi.fn(async () => true),
  markSent: vi.fn(async () => true),
  markFailed: vi.fn(async () => true),
  markDeliveryUnknown: vi.fn(async () => true),
});

const deliveryInput = () => ({
  enabled: true,
  tenantId: TENANT_ID,
  recipientOpenId: 'ou_sales_a',
  evidence: {
    opportunityRecordId: 'opportunity-1',
    opportunityName: '北辰数字化项目',
    ownerOpenId: 'ou_sales_a',
    followupRecordId: 'followup-1',
    lastEffectiveFollowupAt: '2026-09-20T02:00:00.000Z',
    followupVersion: 'version-1',
  },
  now: NOW,
});

describe('FeishuStaleOpportunityReminderSender', (): void => {
  it('sends a stable bot direct message to the current owner', async (): Promise<void> => {
    const current: SenderHarness = harness();
    const input: StaleOpportunityReminderMessage = message({
      opportunityName: '北辰数字化项目\n伪造下一行',
    });

    await expect(current.sender.send(input)).resolves.toEqual({
      messageId: 'om_reminder_1',
    });
    expect(current.resolveTenantById).toHaveBeenCalledWith(TENANT_ID);
    expect(current.createMessage).toHaveBeenCalledWith(
      {
        params: { receive_id_type: 'open_id' },
        data: {
          receive_id: 'ou_sales_a',
          msg_type: 'text',
          content: JSON.stringify({
            text: [
              '商机跟进提醒',
              '',
              '商机：北辰数字化项目 伪造下一行',
              '情况：已超过 7 天没有可核实的有效跟进',
              '最近有效跟进时间：2026-09-20T02:00:00.000Z',
              '建议动作：核对客户进展并确认下一步跟进安排',
              '',
              '请先确认商机最新状态，再开展后续跟进。',
            ].join('\n'),
          }),
          uuid: createHash('sha256')
            .update(input.idempotencyKey)
            .digest('hex')
            .slice(0, 40),
        },
      },
      current.requestOptions,
    );
  });

  it('rejects an unavailable or mismatched tenant before dispatch', async (): Promise<void> => {
    const createMessage = vi.fn();
    const clients = {
      getClient: (): unknown => ({
        im: { message: { create: createMessage } },
      }),
      getRequestOptions: (): undefined => undefined,
    } as unknown as FeishuClientFactory;

    for (const resolved of [
      null,
      integration({ status: 'disabled' }),
      integration({ tenantId: '10000000-0000-4000-8000-00000000000b' }),
    ]) {
      const sender = new FeishuStaleOpportunityReminderSender({
        resolveTenantById: vi.fn(async () => resolved),
      }, clients);
      await expect(sender.send(message())).rejects.toBeInstanceOf(
        RetryableStaleOpportunityReminderError,
      );
    }
    expect(createMessage).not.toHaveBeenCalled();
  });

  it('classifies an explicit Feishu rejection as safely retryable', async (): Promise<void> => {
    const current: SenderHarness = harness({
      code: 230001,
      msg: 'bot is unavailable to the recipient',
      data: {},
    });

    await expect(current.sender.send(message())).rejects.toEqual(
      expect.objectContaining({
        name: 'RetryableStaleOpportunityReminderError',
        message: expect.stringContaining('bot is unavailable'),
      }),
    );
  });

  it('keeps a transport rejection as an unknown delivery outcome', async (): Promise<void> => {
    const transportError = new Error('socket closed after request write');
    const createMessage = vi.fn(async (): Promise<never> => {
      throw transportError;
    });
    const clients = {
      getClient: (): unknown => ({
        im: { message: { create: createMessage } },
      }),
      getRequestOptions: (): undefined => undefined,
    } as unknown as FeishuClientFactory;
    const sender = new FeishuStaleOpportunityReminderSender({
      resolveTenantById: vi.fn(async () => integration()),
    }, clients);
    const delivery: Promise<{ messageId: string }> = sender.send(message());

    await expect(delivery).rejects.toBe(transportError);
    await expect(delivery).rejects.not.toBeInstanceOf(
      RetryableStaleOpportunityReminderError,
    );
    expect(createMessage).toHaveBeenCalledTimes(1);
  });

  it('treats a success response without a message ID as unknown', async (): Promise<void> => {
    const current: SenderHarness = harness({
      code: 0,
      msg: 'ok',
      data: {},
    });
    const delivery: Promise<{ messageId: string }> =
      current.sender.send(message());

    await expect(delivery).rejects.toEqual(
      expect.objectContaining({
        name: 'FeishuApiError',
        code: 'EMPTY_RESULT',
      }),
    );
    await expect(delivery).rejects.not.toBeInstanceOf(
      RetryableStaleOpportunityReminderError,
    );
    expect(current.createMessage).toHaveBeenCalledTimes(1);
  });

  it('records an explicit Feishu rejection as a retryable ledger failure', async (): Promise<void> => {
    const current: SenderHarness = harness({
      code: 230001,
      msg: 'bot is unavailable to the recipient',
      data: {},
    });
    const store: StaleOpportunityReminderStore = reminderStore();
    const service = new StaleOpportunityReminderService(
      store,
      current.sender,
    );

    await expect(service.deliver(deliveryInput())).resolves.toEqual({
      status: 'failed',
      reason: 'delivery_failed',
      retryAt: '2026-09-29T02:15:00.000Z',
    });
    expect(store.markFailed).toHaveBeenCalledWith(expect.objectContaining({
      claimToken: 'claim-adapter-1',
      failureCode: 'REMINDER_DELIVERY_FAILED',
    }));
    expect(store.markDeliveryUnknown).not.toHaveBeenCalled();
  });

  it('records a transport rejection as uncertain and stops automatic retry', async (): Promise<void> => {
    const createMessage = vi.fn(async (): Promise<never> => {
      throw new Error('socket closed after request write');
    });
    const clients = {
      getClient: (): unknown => ({
        im: { message: { create: createMessage } },
      }),
      getRequestOptions: (): undefined => undefined,
    } as unknown as FeishuClientFactory;
    const sender = new FeishuStaleOpportunityReminderSender({
      resolveTenantById: vi.fn(async () => integration()),
    }, clients);
    const store: StaleOpportunityReminderStore = reminderStore();
    const service = new StaleOpportunityReminderService(store, sender);

    await expect(service.deliver(deliveryInput())).resolves.toEqual({
      status: 'failed',
      reason: 'delivery_unknown',
    });
    expect(store.markFailed).not.toHaveBeenCalled();
    expect(store.markDeliveryUnknown).toHaveBeenCalledWith(
      expect.objectContaining({
        claimToken: 'claim-adapter-1',
        failureCode: 'REMINDER_DELIVERY_UNKNOWN',
      }),
    );
    expect(createMessage).toHaveBeenCalledTimes(1);
  });
});
