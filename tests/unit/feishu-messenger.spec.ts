import { describe, expect, it, vi } from 'vitest';

import type { JsonObject } from '@shared/api.interface';
import type {
  TenantIntegration,
} from '@server/modules/agent-core/agent.types';
import type {
  FeishuClientFactory,
} from '@server/modules/feishu/feishu-client.factory';
import {
  FeishuMessengerService,
} from '@server/modules/feishu/feishu-messenger.service';

const createIntegration = (): TenantIntegration => ({
  tenantId: '00000000-0000-0000-0000-00000000000a',
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
});

describe('FeishuMessengerService', (): void => {
  it('edits an already sent text message with the original message ID', async (): Promise<void> => {
    const updateMessage = vi.fn(async (): Promise<{
      code: number;
      msg: string;
    }> => ({ code: 0, msg: 'ok' }));
    const clients = {
      getClient: (): unknown => ({
        im: { message: { update: updateMessage } },
      }),
      getRequestOptions: (): undefined => undefined,
    } as unknown as FeishuClientFactory;
    const messenger = new FeishuMessengerService(clients);

    await messenger.updateText(
      createIntegration(),
      'om_waiting',
      '最终回答',
    );

    expect(updateMessage).toHaveBeenCalledWith(
      {
        path: { message_id: 'om_waiting' },
        data: {
          msg_type: 'text',
          content: JSON.stringify({ text: '最终回答' }),
        },
      },
      undefined,
    );
  });

  it('updates a sent card by its persisted message ID', async (): Promise<void> => {
    const patchMessage = vi.fn(async (): Promise<{
      code: number;
      msg: string;
    }> => ({ code: 0, msg: 'ok' }));
    const clients = {
      getClient: (): unknown => ({
        im: { message: { patch: patchMessage } },
      }),
      getRequestOptions: (): undefined => undefined,
    } as unknown as FeishuClientFactory;
    const messenger = new FeishuMessengerService(clients);
    const card: JsonObject = {
      schema: '2.0',
      header: { title: { tag: 'plain_text', content: 'v2' } },
    };

    await messenger.updateCard(createIntegration(), 'om_card_v1', card);

    expect(patchMessage).toHaveBeenCalledWith(
      {
        path: { message_id: 'om_card_v1' },
        data: { content: JSON.stringify(card) },
      },
      undefined,
    );
  });
});
