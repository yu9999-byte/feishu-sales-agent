import { Readable } from 'node:stream';

import * as lark from '@larksuiteoapi/node-sdk';
import { describe, expect, it, vi } from 'vitest';

import type { TenantIntegration } from
  '@server/modules/agent-core/agent.types';
import type { FeishuClientFactory } from
  '@server/modules/feishu/feishu-client.factory';
import { FeishuMinutesGateway } from
  '@server/modules/feishu/feishu-minutes.gateway';
import { MinutesTranscriptGatewayError } from
  '@server/modules/sales-behavior/minutes-ingestion.service';

const integration: TenantIntegration = {
  tenantId: '00000000-0000-4000-8000-00000000000a',
  feishuTenantKey: 'tenant-a',
  name: '华东示范企业',
  status: 'active',
  appId: 'cli_test',
  appSecretEnv: 'TEST_APP_SECRET',
  appType: 'selfBuild',
  base: {
    appToken: 'base_test',
    customers: {
      tableId: 'customers',
      primaryField: '客户名称',
      fields: { customerName: '客户名称' },
    },
    opportunities: {
      tableId: 'opportunities',
      primaryField: '商机名称',
      fields: {
        opportunityName: '商机名称',
        customerLink: '关联客户',
      },
    },
    followups: {
      tableId: 'followups',
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
};

describe('FeishuMinutesGateway', (): void => {
  it('requests metadata and transcript with speaker and timestamp only', async (): Promise<void> => {
    const getMinute = vi.fn(async (): Promise<unknown> => ({
      code: 0,
      data: { minute: { title: '北辰项目复盘' } },
    }));
    const getTranscript = vi.fn(async (): Promise<unknown> => ({
      getReadableStream: (): Readable => Readable.from([
        Buffer.from('张总 00:00:01.000\n方案认可。', 'utf8'),
      ]),
    }));
    const artifacts = vi.fn();
    const client = {
      minutes: {
        v1: {
          minute: { get: getMinute, artifacts },
          minuteTranscript: { get: getTranscript },
        },
      },
    } as unknown as lark.Client;
    const factory = {
      getClient: (): lark.Client => client,
    } as unknown as FeishuClientFactory;
    const gateway: FeishuMinutesGateway = new FeishuMinutesGateway(factory);

    await expect(gateway.readTranscript({
      integration,
      minuteToken: 'obcnq3b9jl72l83w4f14xxxx',
      accessToken: 'uat-current',
    })).resolves.toEqual({
      title: '北辰项目复盘',
      transcript: '张总 00:00:01.000\n方案认可。',
    });
    expect(getTranscript).toHaveBeenCalledWith(
      {
        path: { minute_token: 'obcnq3b9jl72l83w4f14xxxx' },
        params: {
          need_speaker: true,
          need_timestamp: true,
          file_format: 'txt',
        },
      },
      expect.anything(),
    );
    expect(artifacts).not.toHaveBeenCalled();
  });

  it('maps permission denial without exposing upstream resource details', async (): Promise<void> => {
    const denied: Error & { response?: unknown } = new Error('secret detail');
    denied.response = { data: { code: 2091005, msg: 'permission deny' } };
    const client = {
      minutes: {
        v1: {
          minute: {
            get: vi.fn(async (): Promise<never> => {
              throw denied;
            }),
          },
          minuteTranscript: { get: vi.fn() },
        },
      },
    } as unknown as lark.Client;
    const factory = {
      getClient: (): lark.Client => client,
    } as unknown as FeishuClientFactory;
    const gateway: FeishuMinutesGateway = new FeishuMinutesGateway(factory);

    await expect(gateway.readTranscript({
      integration,
      minuteToken: 'obcnq3b9jl72l83w4f14xxxx',
      accessToken: 'uat-current',
    })).rejects.toEqual(new MinutesTranscriptGatewayError('ACCESS_DENIED'));
  });
});
