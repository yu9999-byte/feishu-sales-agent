import { describe, expect, it, vi } from 'vitest';

import type {
  CustomerCommunicationPreparationResponse,
  CustomerVisitBriefingResponse,
} from '@shared/api.interface';
import type { TenantIntegration } from
  '@server/modules/agent-core/agent.types';
import {
  CustomerCommunicationPreparationService,
  type CustomerCommunicationBriefingReader,
} from '@server/modules/insight/customer-communication-preparation.service';

const NOW = new Date('2026-10-07T05:00:00.000Z');

const integration: TenantIntegration = {
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
  },
};

const briefing = (
  status: CustomerVisitBriefingResponse['status'] = 'ready',
): CustomerVisitBriefingResponse => ({
  referenceDate: '2026-10-07',
  timezone: 'Asia/Shanghai',
  status,
  generatedAt: '2026-10-07T04:00:00.000Z',
  customer: status === 'empty' || status === 'unavailable'
    ? null
    : {
        recordId: 'customer-a',
        name: '北辰科技',
        contactName: null,
        latestSummary: '客户正在梳理年度数字化投入优先级',
        lastFollowupAt: '2026-10-05T02:00:00.000Z',
        source: {
          recordId: 'customer-a',
          recordUrl: 'https://example.test/customers/customer-a',
          sourceVersion: 'customer-v1',
        },
      },
  metrics: {
    relatedOpportunityCount: status === 'ready' ? 1 : 0,
    activeOpportunityCount: status === 'ready' ? 1 : 0,
    riskOpportunityCount: status === 'ready' ? 1 : 0,
    totalFollowupCount: status === 'ready' ? 1 : 0,
    knownActiveExpectedAmount: status === 'ready' ? 280000 : null,
  },
  opportunities: status === 'ready' || status === 'partial'
    ? [{
        recordId: 'opportunity-a',
        name: '年度协同项目',
        lifecycleStatus: 'active',
        expectedAmount: 280000,
        progress: '等待客户确认决策范围',
        nextAction: null,
        dueAt: null,
        health: 'at_risk',
        risks: [{
          code: 'followup_stale',
          severity: 'high',
          title: '长期没有可信跟进',
          detail: '超过 30 天没有可核实沟通',
          evidenceIds: ['followup-a'],
        }],
        gaps: [{
          code: 'next_action_missing',
          title: '下一步缺失',
          detail: '商机没有明确下一步',
          evidenceIds: ['opportunity-a'],
        }],
        recommendation: {
          action: '确认客户决策范围和下一承诺',
          reason: '下一步尚未明确',
          dueAt: null,
          evidenceIds: ['opportunity-a'],
          requiresConfirmation: true,
        },
        source: {
          recordId: 'opportunity-a',
          recordUrl: 'https://example.test/opportunities/opportunity-a',
          sourceVersion: 'opportunity-v1',
        },
      }]
    : [],
  recentFollowups: status === 'ready' || status === 'partial'
    ? [{
        recordId: 'followup-a',
        opportunityRecordId: 'opportunity-a',
        opportunityName: '年度协同项目',
        summary: '客户计划内部确认参与范围',
        communicationAt: '2026-10-05T02:00:00.000Z',
        nextAction: null,
        dueAt: null,
        source: {
          recordId: 'followup-a',
          recordUrl: 'https://example.test/followups/followup-a',
          sourceVersion: 'followup-v1',
        },
      }]
    : [],
  questions: status === 'ready' || status === 'partial'
    ? [{
        code: 'next_action_missing',
        question: '年度协同项目本次沟通后双方要承诺的下一步是什么？',
        reason: '商机下一步尚未明确',
        opportunityRecordId: 'opportunity-a',
      }]
    : [],
  agenda: status === 'ready' || status === 'partial'
    ? [{
        sequence: 1,
        title: '对齐客户当前目标与变化',
        purpose: '确认需求和优先级是否变化',
      }]
    : [],
  coverage: {
    scope: 'self',
    customers: status === 'unavailable' ? 'unavailable' : 'complete',
    opportunities: status === 'partial' ? 'partial' : 'complete',
    followups: status === 'partial' ? 'partial' : 'complete',
    taskPromises: 'agent_confirmed_only',
    associations: 'explicit_record_links_only',
  },
  warnings: status === 'partial'
    ? ['部分跟进来源暂时无法完整读取']
    : status === 'empty'
      ? ['客户不存在或不在本人可见范围内']
      : status === 'unavailable'
        ? ['客户资料暂时不可用']
        : [],
});

interface Harness {
  service: CustomerCommunicationPreparationService;
  reader: CustomerCommunicationBriefingReader;
}

const setup = (
  result: CustomerVisitBriefingResponse = briefing(),
): Harness => {
  const reader: CustomerCommunicationBriefingReader = {
    generate: vi.fn(async () => result),
  };
  return {
    service: new CustomerCommunicationPreparationService(reader),
    reader,
  };
};

const generate = async (
  service: CustomerCommunicationPreparationService,
): Promise<CustomerCommunicationPreparationResponse> => service.generate({
  integration,
  actorOpenId: 'ou_sales_a',
  customerRecordId: 'customer-a',
  referenceDate: '2026-10-07',
  timezone: 'Asia/Shanghai',
  now: NOW,
});

describe('CustomerCommunicationPreparationService', (): void => {
  it('reuses the exact customer briefing and produces traceable content', async (): Promise<void> => {
    const harness: Harness = setup();
    const result: CustomerCommunicationPreparationResponse =
      await generate(harness.service);

    expect(harness.reader.generate).toHaveBeenCalledOnce();
    expect(harness.reader.generate).toHaveBeenCalledWith({
      integration,
      actorOpenId: 'ou_sales_a',
      customerRecordId: 'customer-a',
      referenceDate: '2026-10-07',
      timezone: 'Asia/Shanghai',
      now: NOW,
    });
    expect(result.status).toBe('ready');
    expect(result.objective).toMatchObject({
      title: expect.stringContaining('年度协同项目'),
      sourceKeys: ['opportunity:opportunity-a'],
    });
    expect(result.angles.length).toBeGreaterThan(0);
    expect(result.angles.length).toBeLessThanOrEqual(3);
    const evidenceKeys: Set<string> = new Set(
      result.evidence.map((item) => item.key),
    );
    [result.objective, ...result.angles]
      .filter((item) => item !== null)
      .forEach((item) => {
        item?.sourceKeys.forEach((key: string): void => {
          expect(evidenceKeys.has(key)).toBe(true);
        });
      });
  });

  it('keeps questions as questions and never invents retrieved materials', async (): Promise<void> => {
    const result: CustomerCommunicationPreparationResponse =
      await generate(setup().service);

    expect(result.questions[0]).toMatchObject({
      question: '年度协同项目本次沟通后双方要承诺的下一步是什么？',
      reason: '商机下一步尚未明确',
      sourceKeys: ['opportunity:opportunity-a'],
    });
    expect(result.materials.length).toBeGreaterThan(0);
    expect(result.materials.every(
      (item) => item.status === 'material_pending',
    )).toBe(true);
    const serializedMaterials: string = JSON.stringify(result.materials);
    expect(serializedMaterials).not.toContain('https://');
    expect(serializedMaterials).not.toContain('fileToken');
    expect(serializedMaterials).not.toContain('280000');
  });

  it('returns editable preview-only Feishu and email drafts', async (): Promise<void> => {
    const result: CustomerCommunicationPreparationResponse =
      await generate(setup().service);

    expect(result.drafts.map((draft) => draft.channel)).toEqual([
      'feishu',
      'email',
    ]);
    result.drafts.forEach((draft): void => {
      expect(draft.editable).toBe(true);
      expect(draft.execution).toBe('preview_only');
      expect(draft.body).toContain('您好');
      expect(draft.body).not.toContain('王总');
    });
    expect(result.drafts[0].subject).toBeNull();
    expect(result.drafts[1].subject).toContain('北辰科技');
  });

  it('uses a needs-discovery goal when there is no active opportunity', async (): Promise<void> => {
    const noOpportunity: CustomerVisitBriefingResponse = briefing();
    noOpportunity.opportunities = [];
    noOpportunity.metrics.activeOpportunityCount = 0;
    noOpportunity.metrics.relatedOpportunityCount = 0;
    noOpportunity.questions = [];
    const result: CustomerCommunicationPreparationResponse =
      await generate(setup(noOpportunity).service);

    expect(result.objective?.title).toContain('当前变化与新需求');
    expect(JSON.stringify(result)).not.toContain('虚构商机');
    expect(result.materials.every(
      (item) => item.status === 'material_pending',
    )).toBe(true);
  });

  it('preserves partial warnings but returns no plan for empty states', async (): Promise<void> => {
    const partial: CustomerCommunicationPreparationResponse =
      await generate(setup(briefing('partial')).service);
    const empty: CustomerCommunicationPreparationResponse =
      await generate(setup(briefing('empty')).service);
    const unavailable: CustomerCommunicationPreparationResponse =
      await generate(setup(briefing('unavailable')).service);

    expect(partial.status).toBe('partial');
    expect(partial.objective).not.toBeNull();
    expect(partial.warnings).toEqual(['部分跟进来源暂时无法完整读取']);
    [empty, unavailable].forEach((result): void => {
      expect(result.objective).toBeNull();
      expect(result.angles).toEqual([]);
      expect(result.materials).toEqual([]);
      expect(result.drafts).toEqual([]);
      expect(result.evidence).toEqual([]);
    });
  });

  it('fails closed when briefing generation throws', async (): Promise<void> => {
    const harness: Harness = setup();
    vi.mocked(harness.reader.generate).mockRejectedValueOnce(
      new Error('briefing unavailable'),
    );

    const result: CustomerCommunicationPreparationResponse =
      await generate(harness.service);

    expect(result.status).toBe('unavailable');
    expect(result.customer).toBeNull();
    expect(result.drafts).toEqual([]);
    expect(result.warnings).toEqual(['客户拜访攻略暂时不可用']);
  });
});

