import * as lark from '@larksuiteoapi/node-sdk';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { AgentRuntimeConfig } from '@server/config/agent.config';
import type { AgentWorkflowService } from '@server/modules/agent-core/agent-workflow.service';
import {
  decodeCardCallbackObject,
  FeishuWebhookBridge,
} from '@server/modules/feishu/feishu-webhook.bridge';

const runtimeConfig: AgentRuntimeConfig = {
  host: '127.0.0.1',
  port: 3100,
  databaseUrl: 'postgres://test',
  llm: { baseUrl: 'https://example.com', apiKey: 'test', model: 'test' },
  feishu: {
    verificationToken: 'test-token',
    encryptKey: undefined,
    receiveMode: 'websocket',
    appId: 'cli_aa211d0457381bdf',
    appSecret: 'test-secret',
  },
};

afterEach((): void => {
  vi.restoreAllMocks();
});

describe('Feishu Card 2.0 callback decoding', (): void => {
  it('decodes form_value JSON strings into typed callback fields', (): void => {
    expect(decodeCardCallbackObject(JSON.stringify({
      generatedBody: '客户认可方案',
      dueAt: '2026-09-22 14:00 +0800',
      task_0: true,
    }))).toEqual({
      generatedBody: '客户认可方案',
      dueAt: '2026-09-22 14:00 +0800',
      task_0: true,
    });
  });

  it('treats absent action values as an empty object', (): void => {
    expect(decodeCardCallbackObject(undefined)).toEqual({});
    expect(decodeCardCallbackObject('')).toEqual({});
  });
});

describe('Feishu long connection', (): void => {
  it('routes messages and card callbacks through the existing workflow',
    async (): Promise<void> => {
      let dispatcher: lark.EventDispatcher | undefined;
      const start = vi.spyOn(lark.WSClient.prototype, 'start')
        .mockImplementation(async (
          params: { eventDispatcher: lark.EventDispatcher },
        ): Promise<void> => {
          dispatcher = params.eventDispatcher;
        });
      const close = vi.spyOn(lark.WSClient.prototype, 'close')
        .mockImplementation((): void => undefined);
      const handleMessage = vi.fn(async (): Promise<void> => undefined);
      const cardResponse = { toast: { type: 'success', content: '已处理' } };
      const handleCardAction = vi.fn(async (): Promise<typeof cardResponse> =>
        cardResponse);
      const workflow = {
        handleMessage,
        handleCardAction,
      } as unknown as AgentWorkflowService;
      const bridge = new FeishuWebhookBridge(workflow, runtimeConfig);

      await bridge.onModuleInit();
      expect(start).toHaveBeenCalledOnce();
      if (!dispatcher) throw new Error('Missing event dispatcher');

      await dispatcher.invoke({
        schema: '2.0',
        header: {
          event_type: 'im.message.receive_v1',
          tenant_key: 'tenant-1',
        },
        event: {
          sender: {
            sender_id: { open_id: 'user-1' },
            sender_type: 'user',
          },
          message: {
            message_id: 'message-1',
            chat_id: 'chat-1',
            chat_type: 'p2p',
            message_type: 'text',
            content: JSON.stringify({ text: '帮我写跟进' }),
            create_time: '1790236800000',
          },
        },
      }, { needCheck: false });
      await vi.waitFor((): void => {
        expect(handleMessage).toHaveBeenCalledWith(expect.objectContaining({
          text: '帮我写跟进',
          feishuTenantKey: 'tenant-1',
        }));
      });

      const result: unknown = await dispatcher.invoke({
        schema: '2.0',
        header: {
          event_type: 'card.action.trigger',
          tenant_key: 'tenant-1',
          event_id: 'event-1',
        },
        event: {
          token: 'callback-token',
          operator: { open_id: 'user-1' },
          context: { open_message_id: 'card-1', open_chat_id: 'chat-1' },
          action: { tag: 'button', value: { action: 'cancel' } },
        },
      }, { needCheck: false });
      expect(handleCardAction).toHaveBeenCalledWith(expect.objectContaining({
        eventId: 'event-1',
        cardMessageId: 'card-1',
        operatorOpenId: 'user-1',
      }));
      expect(result).toEqual(cardResponse);

      bridge.onModuleDestroy();
      expect(close).toHaveBeenCalledWith({ force: true });
    });

  it('requires app credentials before starting websocket mode',
    async (): Promise<void> => {
      const start = vi.spyOn(lark.WSClient.prototype, 'start')
        .mockResolvedValue(undefined);
      const workflow = {
        handleMessage: vi.fn(),
        handleCardAction: vi.fn(),
      } as unknown as AgentWorkflowService;
      const bridge = new FeishuWebhookBridge(workflow, {
        ...runtimeConfig,
        feishu: { ...runtimeConfig.feishu, appId: undefined },
      });

      await expect(bridge.onModuleInit()).rejects.toThrow('FEISHU_APP_ID');
      expect(start).not.toHaveBeenCalled();
    });
});
