import { describe, expect, it, vi } from 'vitest';

import type { AgentRuntimeConfig } from '@server/config/agent.config';
import {
  ProactiveSalesNotificationService,
} from '@server/modules/insight/proactive-sales-notification.service';

const config = (
  enabled: boolean,
  deliveryEnabled: boolean,
): AgentRuntimeConfig => ({
  host: '127.0.0.1', port: 3100, databaseUrl: 'postgres://unused',
  llm: { baseUrl: 'https://llm.example.com', apiKey: 'secret', model: 'glm' },
  feishu: { verificationToken: 'verify', encryptKey: undefined },
  proactiveSalesNotifications: {
    enabled,
    deliveryEnabled,
    triggerToken: 'scheduler-token',
    webPublicUrl: 'https://agent.example.com',
    enabledKinds: ['daily_report', 'weekly_team'],
    allowedTenantId: '10000000-0000-4000-8000-00000000000a',
    allowedMemberId: '20000000-0000-4000-8000-00000000000a',
    allowedRecipientOpenId: 'ou_sales_a',
  },
});

const dependencies = () => ({
  control: {
    listActiveIntegrations: vi.fn(async () => [{
      tenantId: '10000000-0000-4000-8000-00000000000a',
      feishuTenantKey: 'tenant-a', tenantName: '租户 A', status: 'active' as const,
      appId: 'cli_a', appSecretEnv: 'FEISHU_APP_SECRET', appType: 'self_built' as const,
      base: {
        appToken: 'base-a', customersTableId: 'customers',
        opportunitiesTableId: 'opportunities', followupsTableId: 'followups',
        customerFields: {}, opportunityFields: {}, followupFields: {},
      },
    }]),
  },
  identity: {
    listMembers: vi.fn(async () => [{
      id: '20000000-0000-4000-8000-00000000000a',
      tenantId: '10000000-0000-4000-8000-00000000000a',
      feishuOpenId: 'ou_sales_a', displayName: '销售 A', status: 'active' as const,
    }]),
  },
  sessions: {
    getSessionByMembership: vi.fn(async () => ({
      tenant: {
        id: '10000000-0000-4000-8000-00000000000a',
        name: '租户 A', timezone: 'Asia/Shanghai',
      },
      member: {
        id: '20000000-0000-4000-8000-00000000000a',
        feishuOpenId: 'ou_sales_a', displayName: '销售 A',
      },
      roles: ['sales' as const],
      permissions: [
        'review:read-personal' as const,
        'task:read' as const,
        'opportunity:read' as const,
      ],
      navigation: [], policyVersion: 'v1',
    })),
  },
  tasks: {
    analyze: vi.fn(async () => ({
      referenceDate: '2026-10-12', timezone: 'Asia/Shanghai', status: 'ready' as const,
      generatedAt: '2026-10-12T01:05:00.000Z',
      metrics: {
        openTaskCount: 1, completedTaskCount: 0, overdueCount: 0,
        dueTodayCount: 1, dueSoonCount: 0, unscheduledCount: 0,
        scheduledCount: 0, promiseCount: 0, linkedOpenPromiseCount: 0,
        completedPromiseCount: 0, partiallyCompletedPromiseCount: 0,
        stillOpenPromiseCount: 0, changedPromiseCount: 0,
        overduePromiseCount: 0, untrackedPromiseCount: 0,
        unverifiablePromiseCount: 0,
      },
      items: [{
        guid: 'task-1', title: '准备演示', status: 'todo', completedAt: null,
        dueAt: '2026-10-12T08:00:00.000Z', dueDate: '2026-10-12',
        daysUntilDue: 0, url: null, category: 'due_today' as const,
        priority: 'high' as const, suggestedAction: '今日处理',
      }],
      completedItems: [], promises: [], changes: [], recommendations: [],
      coverage: {
        openTasks: true as const, completedTasks: 'search_scope' as const,
        promiseReconciliation: 'agent_confirmed_only' as const,
        promiseHistoryDays: 180 as const,
        taskSnapshots: 'latest_observation' as const,
        taskHistory: 'agent_observations' as const,
      },
      warnings: [],
    })),
  },
  opportunities: { analyze: vi.fn() },
  dailyReports: { generate: vi.fn() },
  teamReviews: { generate: vi.fn() },
  planner: {
    planTaskAction: vi.fn(() => ({
      tenantId: '10000000-0000-4000-8000-00000000000a',
      recipientMemberId: '20000000-0000-4000-8000-00000000000a',
      recipientOpenId: 'ou_sales_a', kind: 'task_action' as const,
      notificationKey: '2026-10-12', subjectKey: 'task-digest',
      title: '今日任务行动提醒', subtitle: '1 个任务需要关注',
      sections: [{ title: '今日到期 · 1', lines: ['准备演示'] }],
      payloadFingerprint: 'fingerprint',
    })),
    planOpportunityRisks: vi.fn(),
    planDailyReport: vi.fn(),
    planPersonalWeeklyReport: vi.fn(),
    planTeamWeeklyReport: vi.fn(),
  },
  delivery: { deliver: vi.fn() },
  riskStates: { saveRiskState: vi.fn() },
});

describe('ProactiveSalesNotificationService', (): void => {
  it('performs zero reads while the feature is disabled', async (): Promise<void> => {
    const deps = dependencies();
    const service = new ProactiveSalesNotificationService(
      config(false, false), deps.control, deps.identity, deps.sessions,
      deps.tasks, deps.opportunities, deps.dailyReports, deps.teamReviews,
      deps.planner, deps.delivery, deps.riskStates,
    );
    const result = await service.run({
      now: new Date('2026-10-12T01:05:00.000Z'),
    });
    expect(result.status).toBe('disabled');
    expect(deps.control.listActiveIntegrations).not.toHaveBeenCalled();
  });

  it('plans a tenant-local task notification without sending when delivery is off', async (): Promise<void> => {
    const deps = dependencies();
    deps.dailyReports.generate.mockResolvedValue({
      reportDate: '2026-10-12', timezone: 'Asia/Shanghai',
      status: 'empty' as const, generatedAt: '2026-10-12T09:05:00.000Z',
      metrics: {
        followupCount: 0, opportunityCount: 0,
        openTaskCount: 0, overdueTaskCount: 0,
      },
      followups: [], opportunities: [], tasks: [], highlights: [],
      nextActions: [], warnings: [],
    });
    deps.planner.planDailyReport.mockReturnValue({
      tenantId: '10000000-0000-4000-8000-00000000000a',
      recipientMemberId: '20000000-0000-4000-8000-00000000000a',
      recipientOpenId: 'ou_sales_a', kind: 'daily_report' as const,
      notificationKey: '2026-10-12', subjectKey: '2026-10-12',
      title: '销售日报', subtitle: '今日无新增', sections: [],
      payloadFingerprint: 'daily-fingerprint',
    });
    const service = new ProactiveSalesNotificationService(
      config(true, false), deps.control, deps.identity, deps.sessions,
      deps.tasks, deps.opportunities, deps.dailyReports, deps.teamReviews,
      deps.planner, deps.delivery, deps.riskStates,
    );
    const result = await service.run({
      now: new Date('2026-10-12T09:05:00.000Z'),
    });
    expect(result.status).toBe('plan_only');
    expect(result.summary).toEqual(expect.objectContaining({
      tenantCount: 1, memberCount: 1, plannedCount: 1, sentCount: 0,
    }));
    expect(deps.dailyReports.generate).toHaveBeenCalledOnce();
    expect(deps.tasks.analyze).not.toHaveBeenCalled();
    expect(deps.delivery.deliver).not.toHaveBeenCalled();
    expect(deps.riskStates.saveRiskState).not.toHaveBeenCalled();
  });

  it('fails closed before any tenant read when the exact rollout scope is absent', async (): Promise<void> => {
    const deps = dependencies();
    const unsafeConfig: AgentRuntimeConfig = config(true, true);
    unsafeConfig.proactiveSalesNotifications = {
      ...unsafeConfig.proactiveSalesNotifications!,
      allowedMemberId: undefined,
    };
    const service = new ProactiveSalesNotificationService(
      unsafeConfig, deps.control, deps.identity, deps.sessions,
      deps.tasks, deps.opportunities, deps.dailyReports, deps.teamReviews,
      deps.planner, deps.delivery, deps.riskStates,
    );

    const result = await service.run({
      now: new Date('2026-10-12T09:05:00.000Z'),
    });

    expect(result.status).toBe('blocked');
    expect(result.warnings).toEqual(['rollout_scope_not_configured']);
    expect(deps.control.listActiveIntegrations).not.toHaveBeenCalled();
    expect(deps.identity.listMembers).not.toHaveBeenCalled();
    expect(deps.delivery.deliver).not.toHaveBeenCalled();
  });

  it('does not read member business data outside the exact rollout allowlist', async (): Promise<void> => {
    const deps = dependencies();
    const restrictedConfig: AgentRuntimeConfig = config(true, true);
    restrictedConfig.proactiveSalesNotifications = {
      ...restrictedConfig.proactiveSalesNotifications!,
      allowedRecipientOpenId: 'ou_other_user',
    };
    const service = new ProactiveSalesNotificationService(
      restrictedConfig, deps.control, deps.identity, deps.sessions,
      deps.tasks, deps.opportunities, deps.dailyReports, deps.teamReviews,
      deps.planner, deps.delivery, deps.riskStates,
    );

    await service.run({
      now: new Date('2026-10-12T09:05:00.000Z'),
    });

    expect(deps.sessions.getSessionByMembership).not.toHaveBeenCalled();
    expect(deps.dailyReports.generate).not.toHaveBeenCalled();
    expect(deps.delivery.deliver).not.toHaveBeenCalled();
  });

  it('does not count a member when only disabled notification kinds match', async (): Promise<void> => {
    const deps = dependencies();
    const service = new ProactiveSalesNotificationService(
      config(true, false), deps.control, deps.identity, deps.sessions,
      deps.tasks, deps.opportunities, deps.dailyReports, deps.teamReviews,
      deps.planner, deps.delivery, deps.riskStates,
    );

    const result = await service.run({
      now: new Date('2026-10-12T01:05:00.000Z'),
    });

    expect(result.summary).toEqual(expect.objectContaining({
      tenantCount: 0,
      memberCount: 0,
      plannedCount: 0,
    }));
    expect(deps.tasks.analyze).not.toHaveBeenCalled();
  });
});

it('runs due reminders outside daily windows with delivery disabled and rereads resolved state', async () => {
  const deps = dependencies();
  const settings = config(true, false);
  settings.proactiveSalesNotifications!.enabledKinds = ['task_action'];
  const due = { itemId: 'task:1', itemVersion: 'v1', revision: 1,
    status: 'snoozed' as const, remindAt: '2026-10-12T02:00:00Z' };
  const states = { listDue: vi.fn().mockResolvedValue([due]),
    read: vi.fn().mockResolvedValue({ ...due, status: 'resolved' }) };
  const actions = { analyze: vi.fn().mockResolvedValue({ items: [] }) };
  deps.sessions.getSessionByMembership.mockResolvedValue({
    ...(await deps.sessions.getSessionByMembership()),
    permissions: ['customer:read', 'opportunity:read', 'task:read'],
  });
  const service = new ProactiveSalesNotificationService(settings,
    deps.control, deps.identity, deps.sessions, deps.tasks, deps.opportunities,
    deps.dailyReports, deps.teamReviews, deps.planner, deps.delivery, deps.riskStates,
    actions as unknown as import('@server/modules/insight/today-action.service').TodayActionService,
    states as unknown as import('@server/modules/insight/postgres-today-action-state.store').PostgresTodayActionStateStore);
  await service.run({ now: new Date('2026-10-12T03:17:00Z') });
  expect(states.listDue).toHaveBeenCalledOnce();
  expect(states.read).toHaveBeenCalledOnce();
  expect(actions.analyze).toHaveBeenCalledOnce();
  expect(deps.delivery.deliver).not.toHaveBeenCalled();
  expect(deps.tasks.analyze).not.toHaveBeenCalled();
});

it('uses the complete action report and persisted state for the daily digest', async () => {
  const deps = dependencies();
  const settings = config(true, true);
  settings.proactiveSalesNotifications!.enabledKinds = ['task_action'];
  const state = { itemId: 'customer:1', itemVersion: 'v1', revision: 0,
    status: 'open' as const, remindAt: null };
  const item = { id: 'customer:1', version: 'v1', kind: 'customer_followup', sourceId: 'source',
    customerRecordId: 'customer', title: '客户跟进', reason: '客户承诺今日沟通', evidence: ['约定记录'],
    suggestedAction: '联系客户', suggestedCompletionDate: '2026-10-12', sourceUrl: null, state };
  const actions = { analyze: vi.fn().mockResolvedValue({ items: [item], warnings: [] }) };
  const states = { listDue: vi.fn().mockResolvedValue([]), read: vi.fn().mockResolvedValue(null) };
  deps.sessions.getSessionByMembership.mockResolvedValue({
    ...(await deps.sessions.getSessionByMembership()),
    permissions: ['customer:read', 'opportunity:read', 'task:read'],
  });
  deps.delivery.deliver.mockResolvedValue({ status: 'sent', reason: 'delivered', messageId: 'card' });
  const service = new ProactiveSalesNotificationService(settings,
    deps.control, deps.identity, deps.sessions, deps.tasks, deps.opportunities,
    deps.dailyReports, deps.teamReviews, deps.planner, deps.delivery, deps.riskStates,
    actions as unknown as import('@server/modules/insight/today-action.service').TodayActionService,
    states as unknown as import('@server/modules/insight/postgres-today-action-state.store').PostgresTodayActionStateStore);
  await service.run({ now: new Date('2026-10-12T01:05:00Z') });
  expect(JSON.stringify(deps.delivery.deliver.mock.calls)).toContain('客户承诺今日沟通');
  expect(deps.tasks.analyze).not.toHaveBeenCalled();
  deps.delivery.deliver.mockClear();
  states.read.mockResolvedValue({ ...state, status: 'resolved' });
  await service.run({ now: new Date('2026-10-12T01:05:00Z') });
  expect(deps.delivery.deliver).not.toHaveBeenCalled();
});
