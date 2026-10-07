import { describe, expect, it, vi } from 'vitest';

import type {
  SalesMaterialSourceConfig,
  TenantIntegration,
} from '@server/modules/agent-core/agent.types';
import {
  SalesKnowledgeQaService,
} from '@server/modules/knowledge/sales-knowledge-qa.service';
import type {
  SalesKnowledgeQaResult,
} from '@server/modules/knowledge/sales-knowledge-qa.ports';
import type {
  SalesMaterialGateway,
  SalesMaterialReadResult,
} from '@server/modules/knowledge/sales-material.ports';

const source = (
  id: string,
  overrides: Partial<SalesMaterialSourceConfig> = {},
): SalesMaterialSourceConfig => ({
  id,
  sourceType: 'docx',
  token: `docx_${id}`,
  url: `https://example.feishu.cn/docx/docx_${id}`,
  applicability: '用于内部销售答疑，最终范围以合同为准。',
  keywords: ['产品能力', '销售 Agent'],
  categories: ['solution_overview'],
  ...overrides,
});

const integration = (
  sources?: SalesMaterialSourceConfig[],
): TenantIntegration => ({
  tenantId: 'tenant-a',
  feishuTenantKey: 'tenant-key-a',
  name: 'Tenant A',
  status: 'active',
  appId: 'app-a',
  appSecretEnv: 'APP_SECRET_A',
  appType: 'selfBuild',
  base: {
    appToken: 'base-a',
    customers: {
      tableId: 'customers',
      primaryField: '客户',
      fields: { customerName: '客户' },
    },
    opportunities: {
      tableId: 'opportunities',
      primaryField: '商机',
      fields: { opportunityName: '商机', customerLink: '客户关联' },
    },
    followups: {
      tableId: 'followups',
      primaryField: '跟进',
      fields: {
        sourceMessageId: '消息',
        customerLink: '客户关联',
        opportunityLink: '商机关联',
        rawText: '原文',
        summary: '摘要',
      },
    },
    knowledge: sources === undefined ? undefined : { sources },
  },
});

const ready = (
  config: SalesMaterialSourceConfig,
  title: string,
  content: string,
): SalesMaterialReadResult => ({
  sourceId: config.id,
  status: 'ready',
  document: {
    sourceId: config.id,
    sourceType: config.sourceType,
    title,
    url: config.url,
    content,
    sourceVersion: 'revision:3',
    applicability: config.applicability,
    keywords: config.keywords,
    categories: config.categories,
    accessVerified: true,
  },
});

interface Harness {
  service: SalesKnowledgeQaService;
  gateway: { readSource: ReturnType<typeof vi.fn> };
}

const setup = (
  implementation?: (
    config: SalesMaterialSourceConfig,
  ) => SalesMaterialReadResult,
): Harness => {
  const gateway = {
    readSource: vi.fn(async (
      _integration: TenantIntegration,
      _actorOpenId: string,
      config: SalesMaterialSourceConfig,
    ): Promise<SalesMaterialReadResult> => implementation
      ? implementation(config)
      : ready(
          config,
          '销售 Agent 产品能力说明',
          '能力概览\n销售 Agent 可以读取客户、商机和跟进记录，给出有来源的推进建议。\n' +
            '执行边界\n所有写操作都需要销售人工确认。',
        )),
  };
  return {
    service: new SalesKnowledgeQaService(
      gateway as unknown as SalesMaterialGateway,
    ),
    gateway,
  };
};

const ask = async (
  service: SalesKnowledgeQaService,
  tenant: TenantIntegration,
  question: string = '销售 Agent 有哪些产品能力？',
): Promise<SalesKnowledgeQaResult> => service.answer({
  integration: tenant,
  actorOpenId: 'ou_sales_a',
  question,
});

describe('SalesKnowledgeQaService', (): void => {
  it('does not call Feishu when the whitelist is not configured', async (): Promise<void> => {
    const harness: Harness = setup();

    const result: SalesKnowledgeQaResult = await ask(
      harness.service,
      integration(),
    );

    expect(result.status).toBe('not_configured');
    expect(result.citations).toEqual([]);
    expect(result.answer).toContain('资料库尚未配置');
    expect(harness.gateway.readSource).not.toHaveBeenCalled();
  });

  it('answers only with an exact traceable paragraph from an allowed source', async (): Promise<void> => {
    const config: SalesMaterialSourceConfig = source('capabilities');
    const harness: Harness = setup();

    const result: SalesKnowledgeQaResult = await ask(
      harness.service,
      integration([config]),
    );

    expect(result).toMatchObject({
      status: 'answered',
      configuredSourceCount: 1,
      checkedSourceCount: 1,
      trustedResultCount: 1,
      warnings: [],
    });
    expect(result.answer).toContain(
      '销售 Agent 可以读取客户、商机和跟进记录，给出有来源的推进建议。',
    );
    expect(result.citations).toEqual([
      expect.objectContaining({
        sourceId: 'capabilities',
        sourceType: 'docx',
        title: '销售 Agent 产品能力说明',
        url: config.url,
        matchedTerms: expect.arrayContaining(['产品能力']),
        excerpt: '销售 Agent 可以读取客户、商机和跟进记录，给出有来源的推进建议。',
        citation: '正文第 2 段',
        sourceVersion: 'revision:3',
        applicability: config.applicability,
        accessVerified: true,
      }),
    ]);
  });

  it('uses stable ranking, deduplicates sources and caps citations at three', async (): Promise<void> => {
    const configs: SalesMaterialSourceConfig[] = [
      source('d', { keywords: ['产品'] }),
      source('a', { keywords: ['产品能力', '销售 Agent'] }),
      source('c', { keywords: ['产品能力'] }),
      source('b', { keywords: ['产品能力'] }),
    ];
    const harness: Harness = setup((config: SalesMaterialSourceConfig) =>
      ready(
        config,
        `${config.id} 产品能力`,
        `说明\n${config.keywords.join('、')}覆盖范围。`,
      ));

    const result: SalesKnowledgeQaResult = await ask(
      harness.service,
      integration(configs),
    );

    expect(result.citations.map((item): string => item.sourceId)).toEqual([
      'a',
      'b',
      'c',
    ]);
  });

  it('does not use a model answer when no trusted source matches', async (): Promise<void> => {
    const config: SalesMaterialSourceConfig = source('pricing', {
      keywords: ['报价审批'],
      categories: ['commercial_boundary'],
    });
    const harness: Harness = setup((item: SalesMaterialSourceConfig) =>
      ready(item, '报价审批制度', '折扣规则\n折扣需要财务批准。'));

    const result: SalesKnowledgeQaResult = await ask(
      harness.service,
      integration([config]),
      '公司有哪些获奖客户案例？',
    );

    expect(result.status).toBe('no_trusted_match');
    expect(result.citations).toEqual([]);
    expect(result.answer).toBe(
      '我没有在你有权访问的企业资料中找到可信答案。',
    );
  });

  it('withholds denied content and distinguishes partial from unavailable', async (): Promise<void> => {
    const matching: SalesMaterialSourceConfig = source('matching');
    const denied: SalesMaterialSourceConfig = source('secret');
    const partialHarness: Harness = setup((config: SalesMaterialSourceConfig) =>
      config.id === 'matching'
        ? ready(
            config,
            '产品能力说明',
            '概览\n产品能力覆盖客户、商机和跟进准备。',
          )
        : {
            sourceId: config.id,
            status: 'access_denied',
            warning: 'secret-title secret-token',
          });
    const unavailableHarness: Harness = setup((config) => ({
      sourceId: config.id,
      status: 'unavailable',
      warning: '资料来源暂时不可用',
    }));

    const partial: SalesKnowledgeQaResult = await ask(
      partialHarness.service,
      integration([matching, denied]),
    );
    const unavailable: SalesKnowledgeQaResult = await ask(
      unavailableHarness.service,
      integration([matching]),
    );

    expect(partial.status).toBe('partial');
    expect(JSON.stringify(partial)).not.toContain('secret-title');
    expect(JSON.stringify(partial)).not.toContain('secret-token');
    expect(unavailable.status).toBe('unavailable');
    expect(unavailable.citations).toEqual([]);
    expect(unavailable.answer).toContain('暂时无法读取');
  });
});
