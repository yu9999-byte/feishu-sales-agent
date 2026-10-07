import { describe, expect, it } from 'vitest';

import { parseTenantBaseMapping } from
  '@server/modules/agent-core/agent.validation';
import type { TenantBaseMapping } from
  '@server/modules/agent-core/agent.types';

const baseMapping = (): Record<string, unknown> => ({
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
});

describe('sales material whitelist configuration', (): void => {
  it('keeps knowledge sources opt-in and disabled by default', (): void => {
    const parsed: TenantBaseMapping = parseTenantBaseMapping(baseMapping());

    expect(parsed.knowledge).toBeUndefined();
  });

  it('accepts explicit docx and wiki node sources', (): void => {
    const input: Record<string, unknown> = baseMapping();
    input.knowledge = {
      sources: [
        {
          id: 'solution-overview',
          sourceType: 'docx',
          token: 'docx_solution',
          url: 'https://example.feishu.cn/docx/docx_solution',
          applicability: '首次方案沟通，最终能力以合同为准',
          keywords: ['协同', '数字化'],
          categories: ['solution_overview'],
        },
        {
          id: 'case-reference',
          sourceType: 'wiki',
          token: 'wikcn_case',
          url: 'https://example.feishu.cn/wiki/wikcn_case',
          applicability: '同类客户案例参考，不代表交付承诺',
          keywords: ['案例', '制造业'],
          categories: ['case_reference'],
        },
      ],
    };

    const parsed: TenantBaseMapping = parseTenantBaseMapping(input);

    expect(parsed.knowledge?.sources).toHaveLength(2);
    expect(parsed.knowledge?.sources.map((source) => source.sourceType)).toEqual([
      'docx',
      'wiki',
    ]);
  });

  it.each([
    ['empty id', { id: '' }],
    ['unknown type', { sourceType: 'drive' }],
    ['empty token', { token: '' }],
    ['non https url', { url: 'http://example.test/docx/a' }],
    ['empty applicability', { applicability: '' }],
    ['empty keywords', { keywords: [] }],
    ['empty categories', { categories: [] }],
    ['unsupported scan flag', { scanAll: true }],
    ['non Feishu host', { url: 'https://example.com/docx/docx_a' }],
    ['mismatched token', {
      url: 'https://example.feishu.cn/docx/docx_other',
    }],
  ])('rejects %s rather than widening the search', (
    _label: string,
    override: Record<string, unknown>,
  ): void => {
    const input: Record<string, unknown> = baseMapping();
    input.knowledge = {
      sources: [{
        id: 'source-a',
        sourceType: 'docx',
        token: 'docx_a',
        url: 'https://example.feishu.cn/docx/docx_a',
        applicability: '仅用于售前介绍',
        keywords: ['方案'],
        categories: ['solution_overview'],
        ...override,
      }],
    };

    expect((): TenantBaseMapping => parseTenantBaseMapping(input)).toThrow();
  });

  it('rejects duplicate stable source ids', (): void => {
    const input: Record<string, unknown> = baseMapping();
    const configured = {
      id: 'duplicate',
      sourceType: 'docx',
      token: 'docx_a',
      url: 'https://example.feishu.cn/docx/docx_a',
      applicability: '仅用于售前介绍',
      keywords: ['方案'],
      categories: ['solution_overview'],
    };
    input.knowledge = { sources: [configured, { ...configured }] };

    expect((): TenantBaseMapping => parseTenantBaseMapping(input)).toThrow();
  });
});
