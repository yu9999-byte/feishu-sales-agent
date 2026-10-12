import { createHash } from 'node:crypto';

import { describe, expect, it, vi } from 'vitest';

import type {
  TenantIntegration,
} from '@server/modules/agent-core/agent.types';
import type {
  FeishuClientFactory,
} from '@server/modules/feishu/feishu-client.factory';
import {
  FeishuProactiveNotificationSender,
} from '@server/modules/feishu/feishu-proactive-notification.sender';
import {
  RetryableProactiveNotificationError,
} from '@server/modules/insight/proactive-notification-delivery.service';
import type {
  ProactiveNotificationMessage,
} from '@server/modules/insight/proactive-notification-delivery.service';

const TENANT_ID: string = '10000000-0000-4000-8000-00000000000a';

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
  overrides: Partial<ProactiveNotificationMessage> = {},
): ProactiveNotificationMessage => ({
  tenantId: TENANT_ID,
  recipientMemberId: '20000000-0000-4000-8000-00000000000a',
  recipientOpenId: 'ou_sales_a',
  kind: 'daily_report',
  notificationKey: '2026-10-12',
  subjectKey: '2026-10-12',
  title: '销售日报',
  subtitle: '2026-10-12 · 数据截至 18:00',
  sections: [{ title: '今日概览', lines: ['跟进 2 条'] }],
  actionLabel: '查看完整日报',
  actionUrl: 'https://agent.example.com/daily-report?date=2026-10-12',
  payloadFingerprint: 'payload-fingerprint',
  ...overrides,
});

interface SenderHarness {
  sender: FeishuProactiveNotificationSender;
  createMessage: ReturnType<typeof vi.fn>;
  resolveTenantById: ReturnType<typeof vi.fn>;
  requestOptions: { headers: Record<string, string> };
}

const harness = (
  response: unknown = {
    code: 0,
    msg: 'ok',
    data: { message_id: 'om_proactive_1' },
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
    sender: new FeishuProactiveNotificationSender(
      { resolveTenantById },
      clients,
    ),
    createMessage,
    resolveTenantById,
    requestOptions,
  };
};

describe('FeishuProactiveNotificationSender', (): void => {
  it('sends a Card 2.0 direct message with a stable UUID', async (): Promise<void> => {
    const current: SenderHarness = harness();
    const input: ProactiveNotificationMessage = message();

    await expect(current.sender.send(input)).resolves.toEqual({
      messageId: 'om_proactive_1',
    });
    expect(current.resolveTenantById).toHaveBeenCalledWith(TENANT_ID);
    expect(current.createMessage).toHaveBeenCalledWith(
      {
        params: { receive_id_type: 'open_id' },
        data: {
          receive_id: 'ou_sales_a',
          msg_type: 'interactive',
          content: expect.stringContaining('"schema":"2.0"'),
          uuid: createHash('sha256')
            .update([
              input.tenantId,
              input.recipientMemberId,
              input.kind,
              input.notificationKey,
            ].join(':'))
            .digest('hex')
            .slice(0, 40),
        },
      },
      current.requestOptions,
    );
  });

  it('classifies an explicit Feishu rejection as retryable', async (): Promise<void> => {
    const current: SenderHarness = harness({
      code: 230001,
      msg: 'bot is unavailable to the recipient',
      data: {},
    });

    await expect(current.sender.send(message())).rejects.toEqual(
      expect.objectContaining({
        name: 'RetryableProactiveNotificationError',
        message: expect.stringContaining('bot is unavailable'),
      }),
    );
  });

  it('keeps a transport rejection as an unknown outcome', async (): Promise<void> => {
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
    const sender = new FeishuProactiveNotificationSender({
      resolveTenantById: vi.fn(async () => integration()),
    }, clients);
    const delivery: Promise<{ messageId: string }> = sender.send(message());

    await expect(delivery).rejects.toBe(transportError);
    await expect(delivery).rejects.not.toBeInstanceOf(
      RetryableProactiveNotificationError,
    );
  });

  it('classifies an explicit HTTP 400 rejection as retryable', async (): Promise<void> => {
    const rejection: Error & {
      isAxiosError: boolean;
      response: { status: number; data: { code: number; msg: string } };
    } = Object.assign(new Error('Request failed with status code 400'), {
      isAxiosError: true,
      response: {
        status: 400,
        data: { code: 230099, msg: 'invalid card content' },
      },
    });
    const createMessage = vi.fn(async (): Promise<never> => {
      throw rejection;
    });
    const clients = {
      getClient: (): unknown => ({
        im: { message: { create: createMessage } },
      }),
      getRequestOptions: (): undefined => undefined,
    } as unknown as FeishuClientFactory;
    const sender = new FeishuProactiveNotificationSender({
      resolveTenantById: vi.fn(async () => integration()),
    }, clients);

    await expect(sender.send(message())).rejects.toEqual(
      expect.objectContaining({
        name: 'RetryableProactiveNotificationError',
        message: expect.stringContaining('HTTP 400'),
      }),
    );
  });

  it('treats a success without message ID as unknown', async (): Promise<void> => {
    const current: SenderHarness = harness({
      code: 0,
      msg: 'ok',
      data: {},
    });
    const delivery: Promise<{ messageId: string }> =
      current.sender.send(message());

    await expect(delivery).rejects.toEqual(expect.objectContaining({
      name: 'FeishuApiError',
      code: 'EMPTY_RESULT',
    }));
    await expect(delivery).rejects.not.toBeInstanceOf(
      RetryableProactiveNotificationError,
    );
  });

  it('maps pre-dispatch tenant and client failures to retryable errors', async (): Promise<void> => {
    const clients = {
      getClient: (): never => {
        throw new Error('secret unavailable');
      },
      getRequestOptions: (): undefined => undefined,
    } as unknown as FeishuClientFactory;
    const tenantFailure = new FeishuProactiveNotificationSender({
      resolveTenantById: vi.fn(async (): Promise<never> => {
        throw new Error('database unavailable');
      }),
    }, clients);
    const clientFailure = new FeishuProactiveNotificationSender({
      resolveTenantById: vi.fn(async () => integration()),
    }, clients);

    await expect(tenantFailure.send(message())).rejects.toEqual(
      expect.objectContaining({
        name: 'RetryableProactiveNotificationError',
        message: expect.stringContaining('tenant lookup'),
      }),
    );
    await expect(clientFailure.send(message())).rejects.toEqual(
      expect.objectContaining({
        name: 'RetryableProactiveNotificationError',
        message: expect.stringContaining('sender configuration'),
      }),
    );
  });

  it('maps request option failure to a retryable pre-dispatch error', async (): Promise<void> => {
    const createMessage = vi.fn();
    const clients = {
      getClient: (): unknown => ({
        im: { message: { create: createMessage } },
      }),
      getRequestOptions: (): never => {
        throw new Error('tenant key unavailable');
      },
    } as unknown as FeishuClientFactory;
    const sender = new FeishuProactiveNotificationSender({
      resolveTenantById: vi.fn(async () => integration()),
    }, clients);

    await expect(sender.send(message())).rejects.toEqual(
      expect.objectContaining({
        name: 'RetryableProactiveNotificationError',
        message: expect.stringContaining('request configuration'),
      }),
    );
    expect(createMessage).not.toHaveBeenCalled();
  });
});
