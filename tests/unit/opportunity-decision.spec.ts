import { describe, expect, it, vi } from 'vitest';

import type {
  OpportunityDecisionResponse,
  TaskFulfillmentResponse,
} from '@shared/api.interface';
import type { SalesRecordsGateway } from
  '@server/modules/agent-core/agent.ports';
import type {
  OpportunityPortfolioResult,
  TenantIntegration,
} from '@server/modules/agent-core/agent.types';
import { OpportunityDecisionService } from
  '@server/modules/insight/opportunity-decision.service';
import type { TaskFulfillmentService } from
  '@server/modules/insight/task-fulfillment.service';

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

const taskReport = (): TaskFulfillmentResponse => ({
  referenceDate: '2026-10-06',
  timezone: 'Asia/Shanghai',
  status: 'ready',
  generatedAt: '2026-10-06T04:00:00.000Z',
  metrics: {
    openTaskCount: 1,
    completedTaskCount: 0,
    overdueCount: 1,
    dueTodayCount: 0,
    dueSoonCount: 0,
    unscheduledCount: 0,
    scheduledCount: 0,
    promiseCount: 1,
    linkedOpenPromiseCount: 1,
    completedPromiseCount: 0,
    partiallyCompletedPromiseCount: 0,
    stillOpenPromiseCount: 1,
    changedPromiseCount: 0,
    overduePromiseCount: 1,
    untrackedPromiseCount: 0,
    unverifiablePromiseCount: 0,
  },
  items: [{
    guid: 'generic-overdue',
    title: '某个标题碰巧包含北辰',
    status: 'todo',
    completedAt: null,
    dueAt: '2026-10-05T02:00:00.000Z',
    dueDate: '2026-10-05',
    daysUntilDue: -1,
    url: null,
    category: 'overdue',
    priority: 'critical',
    suggestedAction: '尽快处理',
  }],
  completedItems: [],
  promises: [{
    pendingActionId: 'action-1',
    customerName: '北辰制造',
    opportunityName: '北辰数字化项目',
    nextAction: '提交实施计划',
    promisedDueAt: '2026-10-05T02:00:00.000Z',
    confirmedAt: '2026-10-01T02:00:00.000Z',
    taskGuid: 'task-1',
    taskUrl: null,
    taskTitle: '提交实施计划',
    taskStatus: 'todo',
    taskCompletedAt: null,
    taskDueAt: '2026-10-05T02:00:00.000Z',
    status: 'open_overdue',
    completionState: 'still_open',
    suggestedAction: '尽快完成已确认任务',
  }],
  changes: [],
  recommendations: [],
  coverage: {
    openTasks: true,
    completedTasks: 'search_scope',
    promiseReconciliation: 'agent_confirmed_only',
    promiseHistoryDays: 180,
    taskSnapshots: 'unavailable',
    taskHistory: 'agent_observations',
  },
  warnings: [],
});

const portfolio = (): OpportunityPortfolioResult => ({
  customers: [{
    recordId: 'customer-1',
    name: '北辰制造',
    contactName: '张总',
    latestSummary: '认可试点价值',
    lastFollowupAt: '2026-09-01T02:00:00.000Z',
    sourceVersion: '2026-10-01T02:00:00.000Z',
    recordUrl: 'https://example.com/customer-1',
  }],
  opportunities: [
    {
      recordId: 'opportunity-1',
      customerRecordId: 'customer-1',
      name: '北辰数字化项目',
      status: 'active',
      expectedAmount: 500000,
      progress: '方案评估中',
      nextAction: '提交实施计划',
      dueAt: '2026-10-05T02:00:00.000Z',
      sourceVersion: '2026-10-01T02:00:00.000Z',
      recordUrl: 'https://example.com/opportunity-1',
    },
    {
      recordId: 'opportunity-2',
      customerRecordId: null,
      name: '未知状态商机',
      status: 'unknown',
      expectedAmount: null,
      progress: null,
      nextAction: null,
      dueAt: null,
      sourceVersion: '2026-10-02T02:00:00.000Z',
      recordUrl: null,
    },
    {
      recordId: 'opportunity-closed',
      customerRecordId: 'customer-1',
      name: '已经关闭的商机',
      status: 'closed',
      expectedAmount: 900000,
      progress: '已结束',
      nextAction: null,
      dueAt: null,
      sourceVersion: null,
      recordUrl: null,
    },
  ],
  followups: [{
    recordId: 'followup-1',
    customerRecordId: 'customer-1',
    opportunityRecordId: 'opportunity-1',
    summary: '客户要求补充实施计划',
    communicationAt: '2026-10-01T02:00:00.000Z',
    nextAction: '提交实施计划',
    dueAt: '2026-10-05T02:00:00.000Z',
    sourceVersion: '2026-10-01T03:00:00.000Z',
    recordUrl: 'https://example.com/followup-1',
  }],
  warnings: [],
});

const setup = (
  portfolioResult: OpportunityPortfolioResult = portfolio(),
  fulfillmentResult: TaskFulfillmentResponse = taskReport(),
): {
  service: OpportunityDecisionService;
  analyzeTasks: ReturnType<typeof vi.fn>;
} => {
  const records = {
    readOpportunityPortfolio: vi.fn(
      async (): Promise<OpportunityPortfolioResult> => portfolioResult,
    ),
  } as unknown as SalesRecordsGateway;
  const analyzeTasks = vi.fn(
    async (): Promise<TaskFulfillmentResponse> => fulfillmentResult,
  );
  const fulfillment = {
    analyze: analyzeTasks,
  } as unknown as TaskFulfillmentService;
  return {
    service: new OpportunityDecisionService(records, fulfillment),
    analyzeTasks,
  };
};

describe('OpportunityDecisionService', (): void => {
  it('ranks active opportunities by explicit risks and excludes closed ones', async (): Promise<void> => {
    const { service, analyzeTasks } = setup();
    const result: OpportunityDecisionResponse = await service.analyze({
      integration,
      actorOpenId: 'ou_sales_a',
      referenceDate: '2026-10-06',
      timezone: 'Asia/Shanghai',
      now: new Date('2026-10-06T04:00:00.000Z'),
    });

    expect(result.priorities.map((item) => item.name)).toEqual([
      '北辰数字化项目',
      '未知状态商机',
    ]);
    expect(result.priorities[0]).toMatchObject({
      rank: 1,
      health: 'critical',
      taskPromises: [{ pendingActionId: 'action-1' }],
    });
    expect(result.priorities[0]?.risks.map((risk) => risk.code)).toEqual(
      expect.arrayContaining(['next_action_overdue', 'confirmed_task_overdue']),
    );
    expect(result.priorities[1]?.gaps.map((gap) => gap.code)).toEqual(
      expect.arrayContaining([
        'customer_missing',
        'progress_missing',
        'amount_missing',
        'next_action_missing',
      ]),
    );
    expect(result.summary.excludedClosedOpportunityCount).toBe(1);
    expect(result.globalTaskAlerts[0]).toMatchObject({
      code: 'overdue_tasks',
      count: 1,
    });
    expect(analyzeTasks).toHaveBeenCalledWith(expect.objectContaining({
      actorOpenId: 'ou_sales_a',
      readOnly: true,
    }));
  });

  it('does not bind ordinary tasks to an opportunity by matching its title', async (): Promise<void> => {
    const report: TaskFulfillmentResponse = taskReport();
    report.promises = [];
    report.metrics.promiseCount = 0;
    report.metrics.linkedOpenPromiseCount = 0;
    const { service } = setup(portfolio(), report);

    const result: OpportunityDecisionResponse = await service.analyze({
      integration,
      actorOpenId: 'ou_sales_a',
      referenceDate: '2026-10-06',
      timezone: 'Asia/Shanghai',
      now: new Date('2026-10-06T04:00:00.000Z'),
    });

    expect(result.priorities[0]?.taskPromises).toEqual([]);
    expect(result.priorities[0]?.risks.map((risk) => risk.code))
      .not.toContain('confirmed_task_overdue');
    expect(result.globalTaskAlerts).toContainEqual(expect.objectContaining({
      code: 'overdue_tasks',
    }));
  });

  it('degrades honestly when a source is incomplete', async (): Promise<void> => {
    const partial: OpportunityPortfolioResult = portfolio();
    partial.warnings = [
      'opportunity_portfolio_followup_pagination_incomplete',
    ];
    const { service } = setup(partial);

    const result: OpportunityDecisionResponse = await service.analyze({
      integration,
      actorOpenId: 'ou_sales_a',
      referenceDate: '2026-10-06',
      timezone: 'Asia/Shanghai',
      now: new Date('2026-10-06T04:00:00.000Z'),
    });

    expect(result.status).toBe('partial');
    expect(result.coverage.followups).toBe('partial');
    expect(result.warnings).toContain(
      '部分业务数据分页未完整返回，排序结果可能不完整',
    );
  });

  it('formats a product-language answer from evidence instead of model claims', async (): Promise<void> => {
    const { service } = setup();
    const result: OpportunityDecisionResponse = await service.analyze({
      integration,
      actorOpenId: 'ou_sales_a',
      referenceDate: '2026-10-06',
      timezone: 'Asia/Shanghai',
      now: new Date('2026-10-06T04:00:00.000Z'),
    });

    const reply: string = service.formatConversationReply(
      result,
      '北辰制造现在最该做什么？',
    );
    expect(reply).toContain('现在最该推进：北辰数字化项目');
    expect(reply).toContain('下一步：先核对逾期任务的真实状态');
    expect(reply).toContain('建议尚未执行');
  });
});
