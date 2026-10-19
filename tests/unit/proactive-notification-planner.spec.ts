import { describe, expect, it, vi } from 'vitest';

import type {
  DailySalesReportResponse,
  OpportunityDecisionResponse,
  TaskFulfillmentResponse,
} from '@shared/api.interface';
import {
  ProactiveNotificationPlannerService,
} from '@server/modules/insight/proactive-notification-planner.service';

const scope = {
  tenantId: '10000000-0000-4000-8000-00000000000a',
  recipientMemberId: '20000000-0000-4000-8000-00000000000a',
  recipientOpenId: 'ou_sales_a',
  localDate: '2026-10-12',
  timezone: 'Asia/Shanghai',
  webPublicUrl: 'https://agent.example.com',
};

const taskReport = (): TaskFulfillmentResponse => ({
  referenceDate: '2026-10-12',
  timezone: 'Asia/Shanghai',
  status: 'ready',
  generatedAt: '2026-10-12T01:00:00.000Z',
  metrics: {
    openTaskCount: 4,
    completedTaskCount: 0,
    overdueCount: 1,
    dueTodayCount: 1,
    dueSoonCount: 2,
    unscheduledCount: 0,
    scheduledCount: 0,
    promiseCount: 0,
    linkedOpenPromiseCount: 0,
    completedPromiseCount: 0,
    partiallyCompletedPromiseCount: 0,
    stillOpenPromiseCount: 0,
    changedPromiseCount: 0,
    overduePromiseCount: 0,
    untrackedPromiseCount: 0,
    unverifiablePromiseCount: 0,
  },
  items: [
    {
      guid: 'overdue', title: '补发报价', status: 'todo', completedAt: null,
      dueAt: '2026-10-11T01:00:00.000Z', dueDate: '2026-10-11',
      daysUntilDue: -1, url: null, category: 'overdue',
      priority: 'critical', suggestedAction: '立即处理',
    },
    {
      guid: 'today', title: '准备演示', status: 'todo', completedAt: null,
      dueAt: '2026-10-12T08:00:00.000Z', dueDate: '2026-10-12',
      daysUntilDue: 0, url: null, category: 'due_today',
      priority: 'high', suggestedAction: '今日处理',
    },
    {
      guid: 'tomorrow', title: '联系决策人', status: 'todo', completedAt: null,
      dueAt: '2026-10-13T08:00:00.000Z', dueDate: '2026-10-13',
      daysUntilDue: 1, url: null, category: 'due_soon',
      priority: 'medium', suggestedAction: '提前准备',
    },
    {
      guid: 'later', title: '下周复盘', status: 'todo', completedAt: null,
      dueAt: '2026-10-15T08:00:00.000Z', dueDate: '2026-10-15',
      daysUntilDue: 3, url: null, category: 'due_soon',
      priority: 'medium', suggestedAction: '按计划',
    },
  ],
  completedItems: [], promises: [], changes: [], recommendations: [],
  coverage: {
    openTasks: true,
    completedTasks: 'search_scope',
    promiseReconciliation: 'agent_confirmed_only',
    promiseHistoryDays: 180,
    taskSnapshots: 'latest_observation',
    taskHistory: 'agent_observations',
  },
  warnings: [],
});

const opportunityReport = (
  health: 'critical' | 'at_risk' | 'needs_attention' | 'on_track',
): OpportunityDecisionResponse => ({
  referenceDate: '2026-10-12', timezone: 'Asia/Shanghai', status: 'ready',
  generatedAt: '2026-10-12T02:00:00.000Z',
  summary: {
    totalOpportunityCount: 1, activeOpportunityCount: 1,
    excludedClosedOpportunityCount: 0,
    criticalCount: health === 'critical' ? 1 : 0,
    atRiskCount: health === 'at_risk' ? 1 : 0,
    needsAttentionCount: health === 'needs_attention' ? 1 : 0,
    onTrackCount: health === 'on_track' ? 1 : 0,
  },
  customers: [],
  priorities: [{
    rank: 1, recordId: 'opp-1', recordUrl: 'https://feishu.cn/base/opp-1',
    name: '北辰项目', customerRecordId: 'customer-1', customerName: '北辰科技',
    lifecycleStatus: 'active', expectedAmount: 100000, progress: '方案阶段',
    lastFollowupAt: '2026-10-01T02:00:00.000Z', lastFollowupSummary: '确认需求',
    nextAction: '约决策人', dueAt: '2026-10-13T02:00:00.000Z', health,
    priorityScore: health === 'critical' ? 80 : health === 'at_risk' ? 50 : 10,
    risks: health === 'on_track' ? [] : [{
      code: 'followup_stale', severity: health === 'critical' ? 'high' : 'medium',
      title: '长时间未跟进', detail: '最近跟进已超过预期', evidenceIds: ['followup:1'],
    }],
    gaps: [], recommendation: {
      action: '联系客户确认项目状态', reason: '跟进停滞', dueAt: null,
      evidenceIds: ['followup:1'], requiresConfirmation: true,
    },
    taskPromises: [], evidence: [],
  }],
  globalTaskAlerts: [],
  coverage: {
    scope: 'self', customers: 'complete', opportunities: 'complete',
    followups: 'complete', taskPromises: 'agent_confirmed_only',
    taskAssociation: 'explicit_agent_confirmation_only',
  },
  warnings: [],
});

describe('ProactiveNotificationPlannerService', (): void => {
  it('fixes snooze time at planning and retains stable callback keys', (): void => {
    const planner = new ProactiveNotificationPlannerService();
    const timedScope = { ...scope, now: new Date('2026-10-12T01:00:00Z') };
    const first = planner.planTaskAction(timedScope, taskReport());
    const second = planner.planTaskAction(timedScope, taskReport());
    const snooze = first?.shortcuts?.find((shortcut) => shortcut.value.operation === 'snooze');
    expect(snooze?.value.remindAt).toBe('2026-10-12T02:00:00.000Z');
    expect(first?.shortcuts).toEqual(second?.shortcuts);
    expect(first?.shortcuts?.length).toBeLessThanOrEqual(8);
  });
  it('merges overdue, due today and due tomorrow into one task card', (): void => {
    const planner = new ProactiveNotificationPlannerService();
    const planned = planner.planTaskAction(scope, taskReport());

    expect(planned).not.toBeNull();
    expect(planned?.kind).toBe('task_action');
    expect(planned?.shortcuts?.some((shortcut) => shortcut.value.operation === 'resolve')).toBe(true);
    expect(planned?.sections.map((section) => section.title)).toEqual([
      '已逾期 · 1', '今日到期 · 1', '明日到期 · 1',
    ]);
    expect(JSON.stringify(planned)).not.toContain('下周复盘');
  });

  it('does not plan a task card when no actionable task exists', (): void => {
    const planner = new ProactiveNotificationPlannerService();
    const report: TaskFulfillmentResponse = taskReport();
    report.items = report.items.filter((item) => item.daysUntilDue === 3);
    expect(planner.planTaskAction(scope, report)).toBeNull();
  });

  it('plans only new or escalated high risks and observes recovery', async (): Promise<void> => {
    const getRiskState = vi.fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        ...scope,
        opportunityRecordId: 'opp-1',
        severityRank: 2,
        payloadFingerprint: 'old',
        observedAt: new Date('2026-10-11T02:00:00.000Z'),
      })
      .mockResolvedValueOnce({
        ...scope,
        opportunityRecordId: 'opp-1',
        severityRank: 3,
        payloadFingerprint: 'critical',
        observedAt: new Date('2026-10-11T02:00:00.000Z'),
      });
    const planner = new ProactiveNotificationPlannerService({
      getRiskState,
      saveRiskState: vi.fn(),
    });

    expect((await planner.planOpportunityRisks(
      scope,
      opportunityReport('at_risk'),
    )).messages).toHaveLength(1);
    expect((await planner.planOpportunityRisks(
      scope,
      opportunityReport('critical'),
    )).messages).toHaveLength(1);
    expect((await planner.planOpportunityRisks(
      scope,
      opportunityReport('on_track'),
    )).messages).toHaveLength(0);
  });

  it('creates a daily report card from real report content', (): void => {
    const planner = new ProactiveNotificationPlannerService();
    const report: DailySalesReportResponse = {
      reportDate: scope.localDate,
      timezone: scope.timezone,
      status: 'ready',
      generatedAt: '2026-10-12T10:00:00.000Z',
      metrics: {
        followupCount: 2, opportunityCount: 1,
        openTaskCount: 3, overdueTaskCount: 1,
      },
      followups: [], opportunities: [], tasks: [],
      highlights: ['当天登记了 2 条跟进'],
      nextActions: ['准备客户方案'], warnings: [],
    };
    const planned = planner.planDailyReport(scope, report);
    expect(planned?.kind).toBe('daily_report');
    expect(JSON.stringify(planned)).toContain('当天登记了 2 条跟进');
    expect(planner.planDailyReport(scope, {
      ...report,
      status: 'unavailable',
    })).toBeNull();
  });

  it('sends a concise zero-activity daily report', (): void => {
    const planner = new ProactiveNotificationPlannerService();
    const report: DailySalesReportResponse = {
      reportDate: scope.localDate,
      timezone: scope.timezone,
      status: 'empty',
      generatedAt: '2026-10-12T10:00:00.000Z',
      metrics: {
        followupCount: 0,
        opportunityCount: 0,
        openTaskCount: 0,
        overdueTaskCount: 0,
      },
      followups: [],
      opportunities: [],
      tasks: [],
      highlights: [],
      nextActions: [],
      warnings: ['当天没有可汇总的销售活动'],
    };

    const planned = planner.planDailyReport(scope, report);
    expect(planned?.kind).toBe('daily_report');
    expect(planned?.subtitle).toBe(`${scope.localDate} · 数据截至 17:00`);
    expect(planned?.sections).toEqual([{
      title: '今日概览',
      lines: ['今日无新增'],
    }]);
  });
});
