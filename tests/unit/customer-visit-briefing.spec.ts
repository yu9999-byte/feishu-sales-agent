import { describe, expect, it, vi } from 'vitest';

import type {
  CustomerVisitBriefingResponse,
  OpportunityDecisionItem,
  OpportunityDecisionResponse,
} from '@shared/api.interface';
import type { SalesRecordsGateway } from
  '@server/modules/agent-core/agent.ports';
import type {
  OpportunityPortfolioResult,
  TenantIntegration,
} from '@server/modules/agent-core/agent.types';
import {
  CustomerVisitBriefingService,
  type CustomerVisitDecisionAnalyzer,
} from '@server/modules/insight/customer-visit-briefing.service';

const NOW = new Date('2026-10-07T04:00:00.000Z');

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

const decisionItem = (
  recordId: string,
  customerRecordId: string,
  expectedAmount: number | null = 200000,
): OpportunityDecisionItem => ({
  rank: 1,
  recordId,
  recordUrl: `https://example.test/opportunities/${recordId}`,
  name: '年度采购项目',
  customerRecordId,
  customerName: '北辰科技',
  lifecycleStatus: 'active',
  expectedAmount,
  progress: null,
  lastFollowupAt: '2026-09-01T02:00:00.000Z',
  lastFollowupSummary: '等待客户内部确认',
  nextAction: null,
  dueAt: null,
  health: 'critical',
  priorityScore: 80,
  risks: [{
    code: 'followup_stale',
    severity: 'high',
    title: '长期没有可信跟进',
    detail: '超过 30 天没有可核实沟通',
    evidenceIds: ['followup-1'],
  }],
  gaps: [{
    code: 'progress_missing',
    title: '当前进展缺失',
    detail: '商机没有明确进展',
    evidenceIds: ['opportunity-1'],
  }, {
    code: 'next_action_missing',
    title: '下一步缺失',
    detail: '商机没有明确下一步',
    evidenceIds: ['opportunity-1'],
  }, {
    code: 'due_at_missing',
    title: '下一步时间缺失',
    detail: '商机没有明确截止时间',
    evidenceIds: ['opportunity-1'],
  }],
  recommendation: {
    action: '确认客户内部决策进度和下一承诺',
    reason: '超过 30 天没有可核实沟通',
    dueAt: null,
    evidenceIds: ['followup-1'],
    requiresConfirmation: true,
  },
  taskPromises: [],
  evidence: [],
});

const decisions = (
  priorities: OpportunityDecisionItem[],
  status: OpportunityDecisionResponse['status'] = 'ready',
  warnings: string[] = [],
): OpportunityDecisionResponse => ({
  referenceDate: '2026-10-07',
  timezone: 'Asia/Shanghai',
  status,
  generatedAt: NOW.toISOString(),
  summary: {
    totalOpportunityCount: priorities.length,
    activeOpportunityCount: priorities.length,
    excludedClosedOpportunityCount: 0,
    criticalCount: priorities.filter(
      (item: OpportunityDecisionItem): boolean => item.health === 'critical',
    ).length,
    atRiskCount: 0,
    needsAttentionCount: 0,
    onTrackCount: 0,
  },
  customers: [],
  priorities,
  globalTaskAlerts: [],
  coverage: {
    scope: 'self',
    customers: 'complete',
    opportunities: 'complete',
    followups: 'complete',
    taskPromises: 'agent_confirmed_only',
    taskAssociation: 'explicit_agent_confirmation_only',
  },
  warnings,
});

const portfolio = (
  warnings: string[] = [],
): OpportunityPortfolioResult => ({
  customers: [{
    recordId: 'customer-a',
    name: '北辰科技',
    contactName: null,
    latestSummary: null,
    lastFollowupAt: '2026-10-06T02:00:00.000Z',
    sourceVersion: 'customer-v1',
    recordUrl: 'https://example.test/customers/customer-a',
  }, {
    recordId: 'customer-same-name',
    name: '北辰科技',
    contactName: '不应关联的人',
    latestSummary: '另一个同名客户',
    lastFollowupAt: null,
    sourceVersion: 'customer-v2',
    recordUrl: null,
  }],
  opportunities: [{
    recordId: 'opportunity-active',
    customerRecordId: 'customer-a',
    name: '年度采购项目',
    status: 'active',
    expectedAmount: 200000,
    progress: null,
    nextAction: null,
    dueAt: null,
    sourceVersion: 'opportunity-v1',
    recordUrl: 'https://example.test/opportunities/opportunity-active',
  }, {
    recordId: 'opportunity-won',
    customerRecordId: 'customer-a',
    name: '去年续费项目',
    status: 'won',
    expectedAmount: 100000,
    progress: '已赢单',
    nextAction: null,
    dueAt: null,
    sourceVersion: 'opportunity-v2',
    recordUrl: null,
  }, {
    recordId: 'opportunity-same-name',
    customerRecordId: 'customer-same-name',
    name: '年度采购项目',
    status: 'active',
    expectedAmount: 999999,
    progress: '其他客户',
    nextAction: '不应出现',
    dueAt: null,
    sourceVersion: 'opportunity-v3',
    recordUrl: null,
  }],
  followups: Array.from({ length: 12 }, (_, index: number) => ({
    recordId: `followup-${index + 1}`,
    customerRecordId: 'customer-a',
    opportunityRecordId: index % 2 === 0 ? 'opportunity-active' : null,
    summary: `历史跟进 ${index + 1}`,
    communicationAt: index === 11
      ? null
      : `2026-10-${String(index + 1).padStart(2, '0')}T02:00:00.000Z`,
    nextAction: null,
    dueAt: null,
    sourceVersion: `followup-v${index + 1}`,
    recordUrl: null,
  })).concat([{
    recordId: 'followup-conflict',
    customerRecordId: 'customer-same-name',
    opportunityRecordId: 'opportunity-active',
    summary: '冲突关联不应出现',
    communicationAt: '2026-10-07T03:00:00.000Z',
    nextAction: null,
    dueAt: null,
    sourceVersion: 'followup-conflict-v1',
    recordUrl: null,
  }, {
    recordId: 'followup-other',
    customerRecordId: 'customer-same-name',
    opportunityRecordId: 'opportunity-same-name',
    summary: '同名客户跟进不应出现',
    communicationAt: '2026-10-07T03:30:00.000Z',
    nextAction: null,
    dueAt: null,
    sourceVersion: 'followup-other-v1',
    recordUrl: null,
  }]),
  warnings,
});

interface Harness {
  service: CustomerVisitBriefingService;
  records: SalesRecordsGateway;
  analyzer: CustomerVisitDecisionAnalyzer;
}

const setup = (
  portfolioResult: OpportunityPortfolioResult = portfolio(),
  decisionResult: OpportunityDecisionResponse = decisions([
    decisionItem('opportunity-active', 'customer-a'),
    decisionItem('opportunity-same-name', 'customer-same-name', 999999),
  ]),
): Harness => {
  const records: SalesRecordsGateway = {
    readOpportunityPortfolio: vi.fn(async () => portfolioResult),
    upsertCustomer: vi.fn(),
    upsertOpportunity: vi.fn(),
    createFollowup: vi.fn(),
  };
  const analyzer: CustomerVisitDecisionAnalyzer = {
    analyze: vi.fn(async () => decisionResult),
  };
  return {
    service: new CustomerVisitBriefingService(records, analyzer),
    records,
    analyzer,
  };
};

const generate = async (
  service: CustomerVisitBriefingService,
  overrides: Partial<{
    integration: TenantIntegration;
    actorOpenId: string;
    customerRecordId: string;
  }> = {},
): Promise<CustomerVisitBriefingResponse> => service.generate({
  integration: overrides.integration ?? integration,
  actorOpenId: overrides.actorOpenId ?? 'ou_sales_a',
  customerRecordId: overrides.customerRecordId ?? 'customer-a',
  referenceDate: '2026-10-07',
  timezone: 'Asia/Shanghai',
  now: NOW,
});

describe('CustomerVisitBriefingService', (): void => {
  it('builds a briefing from exact customer, opportunity and followup links', async (): Promise<void> => {
    const harness: Harness = setup();
    const result: CustomerVisitBriefingResponse = await generate(harness.service);

    expect(result.status).toBe('ready');
    expect(result.customer).toMatchObject({
      recordId: 'customer-a',
      name: '北辰科技',
      contactName: null,
    });
    expect(result.opportunities.map((item) => item.recordId)).toEqual([
      'opportunity-active',
      'opportunity-won',
    ]);
    expect(result.opportunities[0]).toMatchObject({
      health: 'critical',
      recommendation: {
        action: '确认客户内部决策进度和下一承诺',
        requiresConfirmation: true,
      },
    });
    expect(result.opportunities[1]).toMatchObject({
      lifecycleStatus: 'won',
      health: null,
      risks: [],
      gaps: [],
      recommendation: null,
    });
    expect(result.metrics).toMatchObject({
      relatedOpportunityCount: 2,
      activeOpportunityCount: 1,
      riskOpportunityCount: 1,
      totalFollowupCount: 12,
      knownActiveExpectedAmount: 200000,
    });
    expect(result.recentFollowups).toHaveLength(10);
    expect(result.recentFollowups[0].recordId).toBe('followup-11');
    expect(result.recentFollowups.map((item) => item.recordId)).not.toContain(
      'followup-conflict',
    );
    expect(result.recentFollowups.map((item) => item.recordId)).not.toContain(
      'followup-other',
    );
    expect(harness.analyzer.analyze).toHaveBeenCalledWith(
      expect.objectContaining({ portfolio: expect.any(Object) }),
    );
  });

  it('creates questions only from real customer gaps and opportunity findings', async (): Promise<void> => {
    const result: CustomerVisitBriefingResponse = await generate(setup().service);
    const codes: string[] = result.questions.map((item) => item.code);

    expect(codes).toEqual(expect.arrayContaining([
      'contact_missing',
      'customer_summary_missing',
      'progress_missing',
      'next_action_missing',
      'due_at_missing',
      'followup_stale',
    ]));
    expect(new Set(codes).size).toBe(codes.length);
    expect(result.agenda.map((item) => item.sequence)).toEqual([1, 2, 3]);
    expect(result.agenda[2].purpose).toContain('责任人');
  });

  it('returns empty without exposing an inaccessible or missing customer', async (): Promise<void> => {
    const harness: Harness = setup();
    const result: CustomerVisitBriefingResponse = await generate(
      harness.service,
      { customerRecordId: 'customer-outside' },
    );

    expect(result).toMatchObject({
      status: 'empty',
      customer: null,
      opportunities: [],
      recentFollowups: [],
    });
    expect(result.warnings).toEqual(['客户不存在或不在本人可见范围内']);
  });

  it('keeps unknown active amount null and preserves a real zero amount', async (): Promise<void> => {
    const unknownPortfolio: OpportunityPortfolioResult = portfolio();
    unknownPortfolio.opportunities[0].expectedAmount = null;
    const unknown = await generate(setup(
      unknownPortfolio,
      decisions([decisionItem('opportunity-active', 'customer-a', null)]),
    ).service);
    const zeroPortfolio: OpportunityPortfolioResult = portfolio();
    zeroPortfolio.opportunities[0].expectedAmount = 0;
    const zero = await generate(setup(
      zeroPortfolio,
      decisions([decisionItem('opportunity-active', 'customer-a', 0)]),
    ).service);

    expect(unknown.metrics.knownActiveExpectedAmount).toBeNull();
    expect(zero.metrics.knownActiveExpectedAmount).toBe(0);
  });

  it('returns partial while keeping facts when a source is incomplete', async (): Promise<void> => {
    const harness: Harness = setup(
      portfolio(['opportunity_portfolio_followup_pagination_incomplete']),
      decisions(
        [decisionItem('opportunity-active', 'customer-a')],
        'partial',
        ['部分业务数据分页未完整返回，排序结果可能不完整'],
      ),
    );
    const result: CustomerVisitBriefingResponse = await generate(harness.service);

    expect(result.status).toBe('partial');
    expect(result.customer?.recordId).toBe('customer-a');
    expect(result.coverage.followups).toBe('partial');
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  it('fails closed for unavailable identity, integration, gateway or portfolio', async (): Promise<void> => {
    const harness: Harness = setup();
    const inactive = await generate(harness.service, {
      integration: { ...integration, status: 'disabled' },
    });
    const noActor = await generate(harness.service, { actorOpenId: ' ' });
    const gatewayless: SalesRecordsGateway = {
      upsertCustomer: vi.fn(),
      upsertOpportunity: vi.fn(),
      createFollowup: vi.fn(),
    };
    const unavailableGateway = new CustomerVisitBriefingService(
      gatewayless,
      harness.analyzer,
    );
    const gatewaylessResult = await generate(unavailableGateway);
    vi.mocked(harness.records.readOpportunityPortfolio)
      .mockRejectedValueOnce(new Error('source unavailable'));
    const failed = await generate(harness.service);

    expect(inactive.status).toBe('unavailable');
    expect(noActor.status).toBe('unavailable');
    expect(gatewaylessResult.status).toBe('unavailable');
    expect(failed.status).toBe('unavailable');
    expect(harness.analyzer.analyze).not.toHaveBeenCalled();
  });
});
