import { describe, expect, it, vi } from 'vitest';

import type {
  CustomerCommunicationEvidence,
  CustomerCommunicationPendingMaterial,
} from '@shared/api.interface';
import type {
  SalesMaterialSourceConfig,
  TenantIntegration,
} from '@server/modules/agent-core/agent.types';
import {
  SalesMaterialRetrievalService,
} from '@server/modules/knowledge/sales-material-retrieval.service';
import type {
  SalesMaterialGateway,
  SalesMaterialReadResult,
  SalesMaterialRetrievalResult,
} from '@server/modules/knowledge/sales-material.ports';

const source = (
  id: string,
  overrides: Partial<SalesMaterialSourceConfig> = {},
): SalesMaterialSourceConfig => ({
  id,
  sourceType: 'docx',
  token: `docx_${id}`,
  url: `https://example.feishu.cn/docx/docx_${id}`,
  applicability: '售前介绍，最终能力以合同为准',
  keywords: ['协同', '数字化'],
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

const pending: CustomerCommunicationPendingMaterial[] = [{
  id: 'material-solution',
  category: 'solution_overview',
  title: '准备方案能力概览',
  purpose: '说明可支持的协同范围',
  reason: '客户正在梳理数字化协同优先级',
  status: 'material_pending',
  sourceKeys: ['customer:customer-a', 'opportunity:opportunity-a'],
}];

const evidence: CustomerCommunicationEvidence[] = [{
  key: 'customer:customer-a',
  kind: 'customer',
  label: '客户现状',
  value: '客户正在梳理年度数字化投入优先级',
  occurredAt: null,
  source: {
    recordId: 'customer-a',
    recordUrl: 'https://example.test/customer-a',
    sourceVersion: 'customer-v1',
  },
}];

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
    sourceVersion: 'revision:7',
    applicability: config.applicability,
    keywords: config.keywords,
    categories: config.categories,
    accessVerified: true,
  },
});

interface Harness {
  service: SalesMaterialRetrievalService;
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
          '数字化协同方案概览',
          '产品边界\n支持跨部门协同和业务流程数字化。\n合同边界另行确认。',
        )),
  };
  return {
    service: new SalesMaterialRetrievalService(
      gateway as unknown as SalesMaterialGateway,
    ),
    gateway,
  };
};

const retrieve = async (
  service: SalesMaterialRetrievalService,
  tenant: TenantIntegration,
): Promise<SalesMaterialRetrievalResult> => service.retrieve({
  integration: tenant,
  actorOpenId: 'ou_sales_a',
  pendingMaterials: pending,
  evidence,
});

describe('SalesMaterialRetrievalService', (): void => {
  it('does not call Feishu when the tenant has no whitelist', async (): Promise<void> => {
    const harness: Harness = setup();

    const result: SalesMaterialRetrievalResult = await retrieve(
      harness.service,
      integration(),
    );

    expect(result.search.status).toBe('not_configured');
    expect(result.materials).toEqual(pending);
    expect(harness.gateway.readSource).not.toHaveBeenCalled();
  });

  it('returns a traceable real recommendation with an exact excerpt', async (): Promise<void> => {
    const config: SalesMaterialSourceConfig = source('solution');
    const harness: Harness = setup();

    const result: SalesMaterialRetrievalResult = await retrieve(
      harness.service,
      integration([config]),
    );

    expect(result.search).toMatchObject({
      status: 'ready',
      configuredSourceCount: 1,
      checkedSourceCount: 1,
      trustedResultCount: 1,
      warnings: [],
    });
    expect(result.materials).toHaveLength(1);
    expect(result.materials[0]).toMatchObject({
      category: 'solution_overview',
      title: '数字化协同方案概览',
      status: 'recommended',
      sourceType: 'docx',
      url: config.url,
      matchReason: expect.stringContaining('协同'),
      excerpt: '支持跨部门协同和业务流程数字化。',
      citation: '正文第 2 段',
      sourceVersion: 'revision:7',
      applicability: '售前介绍，最终能力以合同为准',
      accessVerified: true,
      sourceKeys: pending[0].sourceKeys,
    });
  });

  it('uses stable ranking, deduplicates sources and caps recommendations at three', async (): Promise<void> => {
    const configs: SalesMaterialSourceConfig[] = [
      source('d', { keywords: ['数字化'] }),
      source('a', { keywords: ['协同', '数字化'] }),
      source('c', { keywords: ['协同'] }),
      source('b', { keywords: ['协同'] }),
    ];
    const harness: Harness = setup((config: SalesMaterialSourceConfig) =>
      ready(
        config,
        `${config.id} 协同资料`,
        `标题\n${config.keywords.join('、')}实施说明`,
      ));

    const result: SalesMaterialRetrievalResult = await retrieve(
      harness.service,
      integration(configs),
    );

    expect(result.materials).toHaveLength(3);
    expect(result.materials.map((item) => item.id)).toEqual([
      'source:a',
      'source:b',
      'source:c',
    ]);
  });

  it('keeps pending needs and says no trusted material when nothing matches', async (): Promise<void> => {
    const config: SalesMaterialSourceConfig = source('pricing', {
      categories: ['commercial_boundary'],
      keywords: ['报价'],
    });
    const harness: Harness = setup((item: SalesMaterialSourceConfig) =>
      ready(item, '报价审批制度', '审批规则\n折扣需要财务批准。'));

    const result: SalesMaterialRetrievalResult = await retrieve(
      harness.service,
      integration([config]),
    );

    expect(result.search.status).toBe('no_trusted_match');
    expect(result.search.warnings).toContain('未找到可信材料');
    expect(result.materials).toEqual(pending);
  });

  it('reports partial and unavailable source coverage honestly', async (): Promise<void> => {
    const matching: SalesMaterialSourceConfig = source('matching');
    const broken: SalesMaterialSourceConfig = source('broken');
    const partialHarness: Harness = setup((config: SalesMaterialSourceConfig) =>
      config.id === 'matching'
        ? ready(config, '协同方案', '说明\n数字化协同能力范围')
        : {
            sourceId: config.id,
            status: 'unavailable',
            warning: '资料来源暂时不可用',
          });
    const unavailableHarness: Harness = setup((config) => ({
      sourceId: config.id,
      status: 'unavailable',
      warning: '资料来源暂时不可用',
    }));

    const partial: SalesMaterialRetrievalResult = await retrieve(
      partialHarness.service,
      integration([matching, broken]),
    );
    const unavailable: SalesMaterialRetrievalResult = await retrieve(
      unavailableHarness.service,
      integration([broken]),
    );

    expect(partial.search.status).toBe('partial');
    expect(partial.search.trustedResultCount).toBe(1);
    expect(unavailable.search.status).toBe('unavailable');
    expect(unavailable.materials).toEqual(pending);
  });
});

