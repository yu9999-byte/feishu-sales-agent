import { describe, expect, it, vi } from 'vitest';

import type { PlatformSessionResponse } from '@shared/api.interface';
import type { TenantIntegration } from
  '@server/modules/agent-core/agent.types';
import type { PlatformSessionService } from
  '@server/modules/platform-shell/platform-session.service';
import {
  findMinutesReference,
  MinutesReferenceError,
} from '@server/modules/sales-behavior/minutes-reference';
import {
  MinutesIngestionError,
  MinutesIngestionService,
  type MinutesTranscriptGateway,
} from '@server/modules/sales-behavior/minutes-ingestion.service';
import {
  normalizeMinutesTranscript,
} from '@server/modules/sales-behavior/minutes-transcript.normalizer';
import type {
  FeishuUserTokenProvider,
} from '@server/modules/web-auth/feishu-user-token.service';

const TENANT_ID: string = '00000000-0000-4000-8000-00000000000a';
const MEMBER_ID: string = '00000000-0000-4000-8000-00000000000b';
const NOW: Date = new Date('2026-10-13T09:00:00+08:00');

const integration: TenantIntegration = {
  tenantId: TENANT_ID,
  feishuTenantKey: 'tenant-a',
  name: '华东示范企业',
  status: 'active',
  appId: 'cli_test',
  appSecretEnv: 'TEST_MINUTES_APP_SECRET',
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

const platformSession: PlatformSessionResponse = {
  tenant: {
    id: TENANT_ID,
    name: '华东示范企业',
    timezone: 'Asia/Shanghai',
  },
  member: {
    id: MEMBER_ID,
    feishuOpenId: 'ou_sales',
    displayName: '季然',
  },
  roles: ['sales'],
  permissions: [
    'workspace:view',
    'followup:create-own',
    'followup:confirm-own',
    'followup:read',
  ],
  navigation: [],
  policyVersion: 'platform-authz-v1',
};

class FakeTokenProvider implements FeishuUserTokenProvider {
  calls: Array<{ tenantId: string; memberId: string }> = [];
  token: string | null = 'uat-current';

  async getValidAccessToken(
    tenant: TenantIntegration,
    memberId: string,
    _now: Date,
  ): Promise<string | null> {
    this.calls.push({ tenantId: tenant.tenantId, memberId });
    return this.token;
  }
}

class FakeMinutesGateway implements MinutesTranscriptGateway {
  calls: Array<{
    tenantId: string;
    minuteToken: string;
    accessToken: string;
  }> = [];
  title: string = '北辰制造项目沟通';
  transcript: string = [
    '销售 00:00:01.120',
    '张总，今天主要确认试点方案。',
    '张总 00:00:08.300',
    '方案认可，下周二请王工线上演示。',
  ].join('\n');

  async readTranscript(input: {
    integration: TenantIntegration;
    minuteToken: string;
    accessToken: string;
  }): Promise<{ title: string; transcript: string }> {
    this.calls.push({
      tenantId: input.integration.tenantId,
      minuteToken: input.minuteToken,
      accessToken: input.accessToken,
    });
    return { title: this.title, transcript: this.transcript };
  }
}

const createService = (): {
  service: MinutesIngestionService;
  tokenProvider: FakeTokenProvider;
  gateway: FakeMinutesGateway;
} => {
  const sessions = {
    getSession: vi.fn(async (): Promise<PlatformSessionResponse> =>
      structuredClone(platformSession)),
  };
  const tokenProvider: FakeTokenProvider = new FakeTokenProvider();
  const gateway: FakeMinutesGateway = new FakeMinutesGateway();
  const service: MinutesIngestionService = new MinutesIngestionService(
    sessions as unknown as PlatformSessionService,
    tokenProvider,
    gateway,
  );
  return { service, tokenProvider, gateway };
};

describe('minutes reference parsing', (): void => {
  it('extracts a stable token from Feishu and Lark URLs', (): void => {
    expect(findMinutesReference(
      '写跟进 https://ldkj.feishu.cn/minutes/obcnq3b9jl72l83w4f14xxxx?from=chat#chapter',
    )).toMatchObject({
      minuteToken: 'obcnq3b9jl72l83w4f14xxxx',
      canonicalUrl: 'https://ldkj.feishu.cn/minutes/obcnq3b9jl72l83w4f14xxxx',
    });
    expect(findMinutesReference(
      'https://acme.larksuite.com/minutes/obcnlarktoken99',
    )?.minuteToken).toBe('obcnlarktoken99');
  });

  it.each([
    'http://ldkj.feishu.cn/minutes/obcnq3b9jl72l83w4f14xxxx',
    'https://feishu.cn.evil.example/minutes/obcnq3b9jl72l83w4f14xxxx',
    'https://127.0.0.1/minutes/obcnq3b9jl72l83w4f14xxxx',
    'https://ldkj.feishu.cn:444/minutes/obcnq3b9jl72l83w4f14xxxx',
    'https://ldkj.feishu.cn/wiki/obcnq3b9jl72l83w4f14xxxx',
    'https://ldkj.feishu.cn/minutes/short',
    'https://user@ldkj.feishu.cn/minutes/obcnq3b9jl72l83w4f14xxxx',
    'https://ldkj.feishu.cn/minutes/obcnA1_b-234',
  ])('rejects an unsafe minutes-looking URL: %s', (value: string): void => {
    expect((): unknown => findMinutesReference(value)).toThrow(
      MinutesReferenceError,
    );
  });

  it('returns null when the message contains no minutes URL', (): void => {
    expect(findMinutesReference('你好，帮我分析一下客户压价。')).toBeNull();
  });
});

describe('minutes transcript normalization', (): void => {
  it('preserves speaker, relative time, and verbatim evidence', (): void => {
    const result = normalizeMinutesTranscript([
      '销售 00:00:01.120',
      '张总，今天主要确认试点方案。',
      '这一段仍属于销售。',
      '张总 00:00:08.300',
      '方案认可，下周二请王工线上演示。',
    ].join('\r\n'));

    expect(result.truncated).toBe(false);
    expect(result.segments).toEqual([
      {
        index: 0,
        speaker: '销售',
        relativeTime: '00:00:01.120',
        text: '张总，今天主要确认试点方案。\n这一段仍属于销售。',
      },
      {
        index: 1,
        speaker: '张总',
        relativeTime: '00:00:08.300',
        text: '方案认可，下周二请王工线上演示。',
      },
    ]);
    expect(result.normalizedText).toContain('销售 00:00:01.120');
    expect(result.normalizedText).toContain('方案认可，下周二请王工线上演示。');
  });

  it('keeps complete head and tail segments when the transcript is long', (): void => {
    const raw: string = Array.from(
      { length: 12 },
      (_value: unknown, index: number): string => [
        `说话人${index} 00:00:${String(index).padStart(2, '0')}.000`,
        `第${index}段${'内容'.repeat(40)}`,
      ].join('\n'),
    ).join('\n');
    const result = normalizeMinutesTranscript(raw, 420);

    expect(result.truncated).toBe(true);
    expect(result.normalizedText).toContain('说话人0 00:00:00.000');
    expect(result.normalizedText).toContain('说话人11 00:00:11.000');
    expect(result.normalizedText).toContain('[中间逐字稿因长度限制已省略]');
    expect(result.normalizedText).not.toMatch(/\uD800$/u);
  });

  it('never exceeds the limit when one segment alone is oversized', (): void => {
    const result = normalizeMinutesTranscript([
      '销售 00:00:01.120',
      '客户沟通内容'.repeat(200),
    ].join('\n'), 240);

    expect(result.truncated).toBe(true);
    expect(result.normalizedText.length).toBeLessThanOrEqual(240);
    expect(result.normalizedText).toContain('销售 00:00:01.120');
    expect(result.normalizedText).toContain('[中间逐字稿因长度限制已省略]');
    expect(result.normalizedText).not.toMatch(/\uD800$/u);
  });
});

describe('MinutesIngestionService', (): void => {
  it('reads only the transcript with the current tenant member token', async (): Promise<void> => {
    const harness = createService();
    const result = await harness.service.ingest({
      integration,
      actorOpenId: 'ou_sales',
      sourceText:
        '写跟进 https://ldkj.feishu.cn/minutes/obcnq3b9jl72l83w4f14xxxx?from=chat',
      now: NOW,
    });

    expect(harness.tokenProvider.calls).toEqual([{
      tenantId: TENANT_ID,
      memberId: MEMBER_ID,
    }]);
    expect(harness.gateway.calls).toEqual([{
      tenantId: TENANT_ID,
      minuteToken: 'obcnq3b9jl72l83w4f14xxxx',
      accessToken: 'uat-current',
    }]);
    expect(result).toMatchObject({
      sourceType: 'minutes',
      title: '北辰制造项目沟通',
      segmentCount: 2,
      truncated: false,
    });
    expect(result.sourceRefHash).toMatch(/^[a-f0-9]{64}$/u);
    expect(result.normalizedText).not.toContain('北辰制造项目沟通');
  });

  it('fails closed before the gateway when user authorization is absent', async (): Promise<void> => {
    const harness = createService();
    harness.tokenProvider.token = null;

    await expect(harness.service.ingest({
      integration,
      actorOpenId: 'ou_sales',
      sourceText: 'https://ldkj.feishu.cn/minutes/obcnq3b9jl72l83w4f14xxxx',
      now: NOW,
    })).rejects.toMatchObject({
      code: 'MINUTES_AUTHORIZATION_REQUIRED',
      retryable: false,
    });
    expect(harness.gateway.calls).toHaveLength(0);
  });

  it('does not leak whether an empty or inaccessible resource exists', async (): Promise<void> => {
    const harness = createService();
    harness.gateway.transcript = '   ';

    await expect(harness.service.ingest({
      integration,
      actorOpenId: 'ou_sales',
      sourceText: 'https://ldkj.feishu.cn/minutes/obcnq3b9jl72l83w4f14xxxx',
      now: NOW,
    })).rejects.toBeInstanceOf(MinutesIngestionError);
  });
});
