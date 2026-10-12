import { describe, expect, it, vi } from 'vitest';

import type { PlatformSessionResponse } from '@shared/api.interface';
import type { TenantIntegration } from
  '@server/modules/agent-core/agent.types';
import type { PlatformSessionService } from
  '@server/modules/platform-shell/platform-session.service';
import {
  DocumentContentGatewayError,
  DocumentIngestionError,
  DocumentIngestionService,
  type DocumentContentGateway,
} from '@server/modules/sales-behavior/document-ingestion.service';
import {
  findDocumentReference,
  DocumentReferenceError,
} from '@server/modules/sales-behavior/document-reference';
import {
  normalizeDocumentContent,
} from '@server/modules/sales-behavior/document-content.normalizer';
import type {
  FeishuUserTokenProvider,
} from '@server/modules/web-auth/feishu-user-token.service';
import { FeishuUserTokenError } from
  '@server/modules/web-auth/feishu-user-token.service';

const TENANT_ID: string = '00000000-0000-4000-8000-00000000000a';
const MEMBER_ID: string = '00000000-0000-4000-8000-00000000000b';
const NOW: Date = new Date('2026-10-13T10:00:00+08:00');

const integration: TenantIntegration = {
  tenantId: TENANT_ID,
  feishuTenantKey: 'tenant-a',
  name: '华东示范企业',
  status: 'active',
  appId: 'cli_test',
  appSecretEnv: 'TEST_DOCUMENT_APP_SECRET',
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
  calls: Array<{ memberId: string; requiredScopes: readonly string[] }> = [];
  token: string | null = 'uat-current';
  failure: FeishuUserTokenError | null = null;

  async getValidAccessToken(
    _tenant: TenantIntegration,
    memberId: string,
    _now: Date,
    requiredScopes: readonly string[],
  ): Promise<string | null> {
    this.calls.push({ memberId, requiredScopes: [...requiredScopes] });
    if (this.failure !== null) throw this.failure;
    return this.token;
  }
}

class FakeDocumentGateway implements DocumentContentGateway {
  calls: Array<{
    referenceType: 'docx' | 'wiki';
    token: string;
    accessToken: string;
  }> = [];
  result = {
    title: '北辰项目沟通纪要',
    revisionId: 7,
    rawContent: '客户确认试点范围。\n\n下周二安排线上技术交流。',
  };
  failure: DocumentContentGatewayError | null = null;

  async readDocument(input: {
    integration: TenantIntegration;
    reference: { referenceType: 'docx' | 'wiki'; token: string };
    accessToken: string;
  }): Promise<{ title: string; revisionId: number; rawContent: string }> {
    this.calls.push({
      referenceType: input.reference.referenceType,
      token: input.reference.token,
      accessToken: input.accessToken,
    });
    if (this.failure !== null) throw this.failure;
    return structuredClone(this.result);
  }
}

const createService = (): {
  service: DocumentIngestionService;
  tokens: FakeTokenProvider;
  gateway: FakeDocumentGateway;
} => {
  const sessions = {
    getSession: vi.fn(async (): Promise<PlatformSessionResponse> =>
      structuredClone(platformSession)),
  };
  const tokens: FakeTokenProvider = new FakeTokenProvider();
  const gateway: FakeDocumentGateway = new FakeDocumentGateway();
  return {
    service: new DocumentIngestionService(
      sessions as unknown as PlatformSessionService,
      tokens,
      gateway,
    ),
    tokens,
    gateway,
  };
};

describe('document reference parsing', (): void => {
  it('extracts Docx and Wiki tokens from trusted Feishu and Lark URLs', (): void => {
    expect(findDocumentReference(
      '写跟进 https://ldkj.feishu.cn/docx/NDlodAhO5ouaYqxQskPcJCpjnoh?from=chat#x',
    )).toEqual({
      referenceType: 'docx',
      token: 'NDlodAhO5ouaYqxQskPcJCpjnoh',
      canonicalUrl:
        'https://ldkj.feishu.cn/docx/NDlodAhO5ouaYqxQskPcJCpjnoh',
    });
    expect(findDocumentReference(
      'https://acme.larksuite.com/wiki/WikcnToken_1234-abc',
    )).toMatchObject({
      referenceType: 'wiki',
      token: 'WikcnToken_1234-abc',
    });
  });

  it.each([
    'http://ldkj.feishu.cn/docx/NDlodAhO5ouaYqxQskPcJCpjnoh',
    'https://feishu.cn.evil.example/docx/NDlodAhO5ouaYqxQskPcJCpjnoh',
    'https://127.0.0.1/wiki/WikcnToken12345678',
    'https://ldkj.feishu.cn:444/wiki/WikcnToken12345678',
    'https://user@ldkj.feishu.cn/docx/NDlodAhO5ouaYqxQskPcJCpjnoh',
    'https://ldkj.feishu.cn/docx/short',
    'https://ldkj.feishu.cn/docx/NDlodAhO5ouaYqxQskPcJCpjnoh/child',
  ])('rejects an unsafe document-looking URL: %s', (value: string): void => {
    expect((): unknown => findDocumentReference(value)).toThrow(
      DocumentReferenceError,
    );
  });

  it('rejects multiple different document references', (): void => {
    expect((): unknown => findDocumentReference(
      'https://ldkj.feishu.cn/docx/NDlodAhO5ouaYqxQskPcJCpjnoh ' +
      'https://ldkj.feishu.cn/wiki/WikcnToken12345678',
    )).toThrow(expect.objectContaining({
      code: 'DOCUMENT_MULTIPLE_REFERENCES',
    }));
  });

  it('returns null when no Docx or Wiki URL is present', (): void => {
    expect(findDocumentReference('你好，帮我分析客户压价。')).toBeNull();
    expect(findDocumentReference(
      'https://ldkj.feishu.cn/minutes/obcnq3b9jl72l83w4f14xxxx',
    )).toBeNull();
  });
});

describe('document content normalization', (): void => {
  it('preserves paragraph order and verbatim text', (): void => {
    const result = normalizeDocumentContent(
      '第一段原文。\r\n\r\n第二段第一行。\r\n第二段第二行。',
    );

    expect(result.truncated).toBe(false);
    expect(result.segments).toEqual([
      { index: 0, text: '第一段原文。' },
      { index: 1, text: '第二段第一行。\n第二段第二行。' },
    ]);
    expect(result.normalizedText).toBe(
      '第一段原文。\n\n第二段第一行。\n第二段第二行。',
    );
  });

  it('keeps visible head and tail evidence within the length limit', (): void => {
    const raw: string = Array.from(
      { length: 12 },
      (_value: unknown, index: number): string =>
        `第${index}段${'内容'.repeat(40)}`,
    ).join('\n\n');
    const result = normalizeDocumentContent(raw, 420);

    expect(result.truncated).toBe(true);
    expect(result.normalizedText.length).toBeLessThanOrEqual(420);
    expect(result.normalizedText).toContain('第0段');
    expect(result.normalizedText).toContain('第11段');
    expect(result.normalizedText).toContain('[中间文档内容因长度限制已省略]');
    expect(result.normalizedText).not.toMatch(/\uD800$/u);
  });

  it('bounds one oversized paragraph without splitting a surrogate pair', (): void => {
    const result = normalizeDocumentContent(
      `开头😀${'客户沟通内容'.repeat(200)}结尾😀`,
      240,
    );

    expect(result.truncated).toBe(true);
    expect(result.normalizedText.length).toBeLessThanOrEqual(240);
    expect(result.normalizedText).toContain('开头😀');
    expect(result.normalizedText).toContain('结尾😀');
    expect(result.normalizedText).toContain('[中间文档内容因长度限制已省略]');
  });
});

describe('DocumentIngestionService', (): void => {
  it('reads Docx with the current member token and document scope only', async (): Promise<void> => {
    const harness = createService();
    const result = await harness.service.ingest({
      integration,
      actorOpenId: 'ou_sales',
      sourceText:
        'https://ldkj.feishu.cn/docx/NDlodAhO5ouaYqxQskPcJCpjnoh',
      now: NOW,
    });

    expect(harness.tokens.calls).toEqual([{
      memberId: MEMBER_ID,
      requiredScopes: ['docx:document:readonly'],
    }]);
    expect(harness.gateway.calls).toEqual([{
      referenceType: 'docx',
      token: 'NDlodAhO5ouaYqxQskPcJCpjnoh',
      accessToken: 'uat-current',
    }]);
    expect(result).toMatchObject({
      sourceType: 'document',
      referenceType: 'docx',
      title: '北辰项目沟通纪要',
      revisionId: 7,
      segmentCount: 2,
      truncated: false,
    });
    expect(result.sourceRefHash).toMatch(/^[a-f0-9]{64}$/u);
  });

  it('requires Wiki node and Docx scopes for a Wiki reference', async (): Promise<void> => {
    const harness = createService();

    await harness.service.ingest({
      integration,
      actorOpenId: 'ou_sales',
      sourceText: 'https://ldkj.feishu.cn/wiki/WikcnToken12345678',
      now: NOW,
    });

    expect(harness.tokens.calls[0]?.requiredScopes).toEqual([
      'wiki:node:read',
      'docx:document:readonly',
    ]);
  });

  it('keeps document tokens and source hashes isolated by tenant and member', async (): Promise<void> => {
    const integrationB: TenantIntegration = {
      ...structuredClone(integration),
      tenantId: '00000000-0000-4000-8000-00000000000c',
      feishuTenantKey: 'tenant-b',
      name: '华南示范企业',
    };
    const memberBId: string =
      '00000000-0000-4000-8000-00000000000d';
    const sessions = {
      getSession: vi.fn(async (input: {
        feishuTenantKey: string;
        feishuOpenId: string;
      }): Promise<PlatformSessionResponse> => {
        const isTenantB: boolean = input.feishuTenantKey === 'tenant-b';
        return {
          ...structuredClone(platformSession),
          tenant: {
            ...platformSession.tenant,
            id: isTenantB ? integrationB.tenantId : integration.tenantId,
            name: isTenantB ? integrationB.name : integration.name,
          },
          member: {
            ...platformSession.member,
            id: isTenantB ? memberBId : MEMBER_ID,
            feishuOpenId: input.feishuOpenId,
          },
        };
      }),
    };
    const tokenCalls: Array<{
      tenantId: string;
      memberId: string;
    }> = [];
    const tokens: FeishuUserTokenProvider = {
      getValidAccessToken: vi.fn(async (
        currentIntegration: TenantIntegration,
        memberId: string,
      ): Promise<string> => {
        tokenCalls.push({
          tenantId: currentIntegration.tenantId,
          memberId,
        });
        return currentIntegration.tenantId === integrationB.tenantId
          ? 'uat-tenant-b-member-b'
          : 'uat-tenant-a-member-a';
      }),
    };
    const gatewayCalls: Array<{
      tenantId: string;
      accessToken: string;
    }> = [];
    const gateway: DocumentContentGateway = {
      readDocument: vi.fn(async (input: {
        integration: TenantIntegration;
        accessToken: string;
      }): Promise<{
        title: string;
        revisionId: number;
        rawContent: string;
      }> => {
        gatewayCalls.push({
          tenantId: input.integration.tenantId,
          accessToken: input.accessToken,
        });
        return {
          title: input.integration.name,
          revisionId: 1,
          rawContent: '同一引用在不同租户下独立读取。',
        };
      }),
    };
    const service = new DocumentIngestionService(
      sessions as unknown as PlatformSessionService,
      tokens,
      gateway,
    );
    const sourceText: string =
      'https://ldkj.feishu.cn/docx/NDlodAhO5ouaYqxQskPcJCpjnoh';

    const resultA = await service.ingest({
      integration,
      actorOpenId: 'ou_sales',
      sourceText,
      now: NOW,
    });
    const resultB = await service.ingest({
      integration: integrationB,
      actorOpenId: 'ou_sales_b',
      sourceText,
      now: NOW,
    });

    expect(tokenCalls).toEqual([
      { tenantId: integration.tenantId, memberId: MEMBER_ID },
      { tenantId: integrationB.tenantId, memberId: memberBId },
    ]);
    expect(gatewayCalls).toEqual([
      {
        tenantId: integration.tenantId,
        accessToken: 'uat-tenant-a-member-a',
      },
      {
        tenantId: integrationB.tenantId,
        accessToken: 'uat-tenant-b-member-b',
      },
    ]);
    expect(resultA.sourceRefHash).not.toBe(resultB.sourceRefHash);
  });

  it('uses a safe fallback title when Docx metadata has no title', async (): Promise<void> => {
    const harness = createService();
    harness.gateway.result.title = '   ';

    await expect(harness.service.ingest({
      integration,
      actorOpenId: 'ou_sales',
      sourceText:
        'https://ldkj.feishu.cn/docx/NDlodAhO5ouaYqxQskPcJCpjnoh',
      now: NOW,
    })).resolves.toMatchObject({ title: '飞书文档' });
  });

  it('fails closed before the gateway when authorization is absent', async (): Promise<void> => {
    const harness = createService();
    harness.tokens.token = null;

    await expect(harness.service.ingest({
      integration,
      actorOpenId: 'ou_sales',
      sourceText:
        'https://ldkj.feishu.cn/docx/NDlodAhO5ouaYqxQskPcJCpjnoh',
      now: NOW,
    })).rejects.toMatchObject({
      code: 'DOCUMENT_AUTHORIZATION_REQUIRED',
      retryable: false,
    });
    expect(harness.gateway.calls).toHaveLength(0);
  });

  it('fails closed before the gateway when a required scope is missing', async (): Promise<void> => {
    const harness = createService();
    harness.tokens.failure = new FeishuUserTokenError(
      'AUTHORIZATION_REQUIRED',
      'missing document scope',
    );

    await expect(harness.service.ingest({
      integration,
      actorOpenId: 'ou_sales',
      sourceText: 'https://ldkj.feishu.cn/wiki/WikcnToken12345678',
      now: NOW,
    })).rejects.toMatchObject({
      code: 'DOCUMENT_AUTHORIZATION_REQUIRED',
      retryable: false,
    });
    expect(harness.gateway.calls).toHaveLength(0);
  });

  it('maps a non-Docx Wiki node without creating partial content', async (): Promise<void> => {
    const harness = createService();
    harness.gateway.failure = new DocumentContentGatewayError(
      'UNSUPPORTED_TYPE',
    );

    await expect(harness.service.ingest({
      integration,
      actorOpenId: 'ou_sales',
      sourceText: 'https://ldkj.feishu.cn/wiki/WikcnToken12345678',
      now: NOW,
    })).rejects.toBeInstanceOf(DocumentIngestionError);
  });

  it('distinguishes empty content and retryable upstream failure', async (): Promise<void> => {
    const emptyHarness = createService();
    emptyHarness.gateway.result.rawContent = '  \n\n  ';
    await expect(emptyHarness.service.ingest({
      integration,
      actorOpenId: 'ou_sales',
      sourceText:
        'https://ldkj.feishu.cn/docx/NDlodAhO5ouaYqxQskPcJCpjnoh',
      now: NOW,
    })).rejects.toMatchObject({
      code: 'DOCUMENT_CONTENT_EMPTY',
      retryable: false,
    });

    const unavailableHarness = createService();
    unavailableHarness.gateway.failure = new DocumentContentGatewayError(
      'UNAVAILABLE',
    );
    await expect(unavailableHarness.service.ingest({
      integration,
      actorOpenId: 'ou_sales',
      sourceText:
        'https://ldkj.feishu.cn/docx/NDlodAhO5ouaYqxQskPcJCpjnoh',
      now: NOW,
    })).rejects.toMatchObject({
      code: 'DOCUMENT_DEPENDENCY_UNAVAILABLE',
      retryable: true,
    });
  });
});
