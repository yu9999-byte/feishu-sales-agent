import { describe, expect, it, vi } from 'vitest';

import type {
  DailyReportTaskRecord,
  DailyReportTaskResult,
  PendingAction,
  TenantIntegration,
} from '@server/modules/agent-core/agent.types';
import type {
  AgentExecutionResult,
  PendingActionPayload,
} from '@shared/api.interface';
import { MemoryControlStore } from '@server/modules/agent-core/memory-control.store';
import {
  TaskFulfillmentService,
  type TaskFulfillmentTasksReader,
} from '@server/modules/insight/task-fulfillment.service';

const NOW: Date = new Date('2026-09-30T04:00:00.000Z');
const integration: TenantIntegration = {
  tenantId: 'tenant-a',
  feishuTenantKey: 'tenant-key-a',
  name: 'Tenant A',
  status: 'active',
  appId: 'cli_test',
  appSecretEnv: 'TEST_SECRET',
  appType: 'selfBuild',
  base: {
    appToken: 'base-a',
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
        rawText: '跟进原文',
        summary: '跟进摘要',
      },
    },
  },
};

const taskResult: DailyReportTaskResult = {
  items: [
    {
      guid: 'scheduled',
      title: '下周准备复盘材料',
      status: 'todo',
      dueAt: '2026-10-08T02:00:00.000Z',
      url: null,
    },
    {
      guid: 'unscheduled',
      title: '补充客户组织关系',
      status: 'todo',
      dueAt: null,
      url: null,
    },
    {
      guid: 'soon',
      title: '准备报价说明',
      status: 'todo',
      dueAt: '2026-10-03T02:00:00.000Z',
      url: null,
    },
    {
      guid: 'today',
      title: '发送会议纪要',
      status: 'todo',
      dueAt: '2026-09-30T02:00:00.000Z',
      url: null,
    },
    {
      guid: 'overdue',
      title: '确认采购预算',
      status: 'todo',
      dueAt: '2026-09-29T02:00:00.000Z',
      url: 'https://example.com/task-overdue',
    },
  ],
};

const makePayload = (nextAction: string): PendingActionPayload => ({
  version: 1,
  sourceMessageId: 'message-1',
  rawText: nextAction,
  draft: {
    customerName: '旧客户',
    contactName: null,
    opportunityName: '旧商机',
    summary: '沟通记录',
    customerNeeds: [],
    objections: [],
    risks: [],
    progress: null,
    expectedAmount: null,
    nextAction,
    dueAt: null,
    evidenceQuotes: [],
  },
});

const saveSucceeded = async (
  store: MemoryControlStore,
  id: string,
  result: Partial<AgentExecutionResult>,
  payload: PendingActionPayload = makePayload('准备报价说明'),
  tenantId: string = integration.tenantId,
  actorOpenId = 'ou_sales_a',
): Promise<void> => {
  await store.createPendingAction({
    id,
    tenantId,
    actorOpenId,
    chatId: 'chat-1',
    payload,
    expiresAt: new Date('2027-01-01T00:00:00.000Z'),
  });
  await store.saveExecutionResult(tenantId, id, 'succeeded', {
    pendingActionId: id,
    status: 'succeeded',
    ...result,
  });
};

describe('TaskFulfillmentService', (): void => {
  it('classifies open tasks in tenant local time and orders risks first', async (): Promise<void> => {
    const tasks: TaskFulfillmentTasksReader = {
      listOwnedTasks: vi.fn(
        async (): Promise<DailyReportTaskResult> => taskResult,
      ),
    };
    const result = await new TaskFulfillmentService(
      tasks,
      new MemoryControlStore([integration]),
    ).analyze({
      integration,
      actorOpenId: 'ou_sales_a',
      referenceDate: '2026-09-30',
      timezone: 'Asia/Shanghai',
      now: NOW,
    });

    expect(result.status).toBe('ready');
    expect(result.metrics).toEqual({
      openTaskCount: 5,
      completedTaskCount: 0,
      overdueCount: 1,
      dueTodayCount: 1,
      dueSoonCount: 1,
      unscheduledCount: 1,
      scheduledCount: 1,
      promiseCount: 0,
      linkedOpenPromiseCount: 0,
      completedPromiseCount: 0,
      partiallyCompletedPromiseCount: 0,
      stillOpenPromiseCount: 0,
      changedPromiseCount: 0,
      overduePromiseCount: 0,
      untrackedPromiseCount: 0,
      unverifiablePromiseCount: 0,
    });
    expect(result.items.map((item) => item.guid)).toEqual([
      'overdue',
      'today',
      'soon',
      'unscheduled',
      'scheduled',
    ]);
    expect(result.items[0]).toMatchObject({
      category: 'overdue',
      priority: 'critical',
      daysUntilDue: -1,
    });
    expect(result.coverage).toEqual({
      openTasks: true,
      completedTasks: 'unavailable',
      promiseReconciliation: 'agent_confirmed_only',
      promiseHistoryDays: 180,
      taskSnapshots: 'latest_observation',
    });
    expect(result.recommendations).toHaveLength(4);
  });

  it('returns partial data when Feishu reports incomplete pagination', async (): Promise<void> => {
    const tasks: TaskFulfillmentTasksReader = {
      listOwnedTasks: async (): Promise<DailyReportTaskResult> => ({
        items: taskResult.items.slice(0, 1),
        warning: 'task_query_pagination_incomplete',
      }),
    };
    const result = await new TaskFulfillmentService(
      tasks,
      new MemoryControlStore([integration]),
    ).analyze({
      integration,
      actorOpenId: 'ou_sales_a',
      referenceDate: '2026-09-30',
      timezone: 'Asia/Shanghai',
      now: NOW,
    });

    expect(result.status).toBe('partial');
    expect(result.metrics.openTaskCount).toBe(1);
    expect(result.warnings).toEqual([
      '飞书任务分页未完整返回，结果可能不完整',
    ]);
  });

  it('returns an honest empty result without inventing completed tasks', async (): Promise<void> => {
    const tasks: TaskFulfillmentTasksReader = {
      listOwnedTasks: async (): Promise<DailyReportTaskResult> => ({ items: [] }),
    };
    const result = await new TaskFulfillmentService(
      tasks,
      new MemoryControlStore([integration]),
    ).analyze({
      integration,
      actorOpenId: 'ou_sales_a',
      referenceDate: '2026-09-30',
      timezone: 'Asia/Shanghai',
      now: NOW,
    });

    expect(result.status).toBe('empty');
    expect(result.items).toEqual([]);
    expect(result.coverage.completedTasks).toBe('unavailable');
  });

  it('fails closed when the task source throws', async (): Promise<void> => {
    const tasks: TaskFulfillmentTasksReader = {
      listOwnedTasks: async (): Promise<DailyReportTaskResult> => {
        throw new Error('Feishu unavailable');
      },
    };
    const result = await new TaskFulfillmentService(
      tasks,
      new MemoryControlStore([integration]),
    ).analyze({
      integration,
      actorOpenId: 'ou_sales_a',
      referenceDate: '2026-09-30',
      timezone: 'Asia/Shanghai',
      now: NOW,
    });

    expect(result.status).toBe('unavailable');
    expect(result.metrics.openTaskCount).toBe(0);
    expect(result.warnings).toEqual(['任务数据源暂时不可用']);
  });

  it('reconciles only this actor and tenant by exact task GUID and final selection', async (): Promise<void> => {
    const store: MemoryControlStore = new MemoryControlStore([integration]);
    const payload: PendingActionPayload = makePayload('旧版下一步');
    payload.taskCandidates = [
      {
        id: 'old', draftId: 'draft', draftVersion: 1,
        ownerMemberId: 'member', title: '旧任务', dueAt: null,
        channel: null, participants: [], customerName: '旧客户',
        opportunityName: '旧商机', status: 'ready', missingFields: [],
      },
      {
        id: 'selected', draftId: 'draft', draftVersion: 2,
        ownerMemberId: 'member', title: '确认采购预算',
        dueAt: '2026-09-29T02:00:00.000Z', channel: null,
        participants: [], customerName: '新客户', opportunityName: '新商机',
        status: 'ready', missingFields: [],
      },
    ];
    payload.selectedTaskCandidateIds = ['selected'];
    await saveSucceeded(store, 'linked', { taskGuid: 'overdue' }, payload);
    await saveSucceeded(store, 'untracked', {}, makePayload('寄送资料'));
    await saveSucceeded(store, 'missing', { taskGuid: 'unknown-guid' });
    await saveSucceeded(store, 'other-actor', { taskGuid: 'today' },
      makePayload('他人任务'), integration.tenantId, 'ou_sales_b');
    await saveSucceeded(store, 'other-tenant', { taskGuid: 'today' },
      makePayload('其他租户任务'), 'tenant-b');
    await saveSucceeded(store, 'other-kind', {}, {
      ...makePayload('变更商机状态'), actionKind: 'opportunity_status',
    });
    await saveSucceeded(store, 'no-next-step', {}, makePayload('暂无下一步'));
    const tasks: TaskFulfillmentTasksReader = {
      listOwnedTasks: async (): Promise<DailyReportTaskResult> => taskResult,
    };
    const report = await new TaskFulfillmentService(tasks, store).analyze({
      integration, actorOpenId: 'ou_sales_a', referenceDate: '2026-09-30',
      timezone: 'Asia/Shanghai', now: NOW,
    });
    expect(report.promises).toHaveLength(3);
    expect(report.promises.find((item) => item.pendingActionId === 'linked'))
      .toMatchObject({
        customerName: '新客户', opportunityName: '新商机',
        nextAction: '确认采购预算', taskGuid: 'overdue',
        taskTitle: '确认采购预算', status: 'open_overdue',
        completionState: 'still_open',
      });
    expect(report.promises.find((item) => item.pendingActionId === 'untracked'))
      .toMatchObject({ status: 'not_task_tracked', taskGuid: null });
    expect(report.promises.find((item) => item.pendingActionId === 'missing'))
      .toMatchObject({ status: 'task_not_visible', taskGuid: 'unknown-guid' });
    expect(report.metrics).toMatchObject({
      promiseCount: 3, linkedOpenPromiseCount: 1,
      partiallyCompletedPromiseCount: 0, stillOpenPromiseCount: 1,
      overduePromiseCount: 1, untrackedPromiseCount: 1,
      unverifiablePromiseCount: 1,
    });
  });

  it('does not infer absence from incomplete task pagination', async (): Promise<void> => {
    const store: MemoryControlStore = new MemoryControlStore([integration]);
    await saveSucceeded(store, 'linked', { taskGuid: 'overdue' });
    await saveSucceeded(store, 'unknown', { taskGuid: 'today' });
    const tasks: TaskFulfillmentTasksReader = {
      listOwnedTasks: async (): Promise<DailyReportTaskResult> => ({
        items: taskResult.items.slice(-1),
        warning: 'task_query_pagination_incomplete',
      }),
    };
    const report = await new TaskFulfillmentService(tasks, store).analyze({
      integration, actorOpenId: 'ou_sales_a', referenceDate: '2026-09-30',
      timezone: 'Asia/Shanghai', now: NOW,
    });
    expect(report.status).toBe('partial');
    expect(report.promises.find((item) => item.pendingActionId === 'linked')?.status)
      .toBe('open_overdue');
    expect(report.promises.find((item) => item.pendingActionId === 'unknown')?.status)
      .toBe('task_lookup_incomplete');
  });

  it('marks capped promise history and failed history reads as partial', async (): Promise<void> => {
    const store: MemoryControlStore = new MemoryControlStore([integration]);
    const actions: PendingAction[] = [];
    for (let index = 0; index < 500; index += 1) {
      actions.push({
        id: `history-${index}`, tenantId: integration.tenantId,
        actorOpenId: 'ou_sales_a', chatId: 'chat', cardMessageId: null,
        status: 'succeeded', payload: makePayload('准备资料'),
        result: { pendingActionId: `history-${index}`, status: 'succeeded' },
        expiresAt: NOW, createdAt: NOW, updatedAt: NOW,
      });
    }
    vi.spyOn(store, 'listSucceededActions').mockResolvedValueOnce(actions)
      .mockRejectedValueOnce(new Error('history unavailable'));
    const tasks: TaskFulfillmentTasksReader = {
      listOwnedTasks: async (): Promise<DailyReportTaskResult> => taskResult,
    };
    const service: TaskFulfillmentService = new TaskFulfillmentService(tasks, store);
    const input = {
      integration, actorOpenId: 'ou_sales_a', referenceDate: '2026-09-30',
      timezone: 'Asia/Shanghai', now: NOW,
    };
    const capped = await service.analyze(input);
    expect(capped.status).toBe('partial');
    expect(capped.warnings).toContain('跟进承诺历史达到本次读取上限，结果可能不完整');
    expect(capped.metrics.promiseCount).toBe(500);
    const failed = await service.analyze(input);
    expect(failed.status).toBe('partial');
    expect(failed.promises).toEqual([]);
    expect(failed.warnings).toContain('Agent 跟进承诺暂时不可读取');
  });

  it('records a baseline and emits evidence when an open task changes', async (): Promise<void> => {
    const store: MemoryControlStore = new MemoryControlStore([integration]);
    let current: DailyReportTaskResult = structuredClone(taskResult);
    const tasks: TaskFulfillmentTasksReader = {
      listOwnedTasks: async (): Promise<DailyReportTaskResult> => current,
    };
    const service: TaskFulfillmentService = new TaskFulfillmentService(tasks, store);
    const input = {
      integration, actorOpenId: 'ou_sales_a', referenceDate: '2026-09-30',
      timezone: 'Asia/Shanghai', now: NOW,
    };
    const first = await service.analyze(input);
    expect(first.changes).toEqual([]);
    current = {
      items: current.items.map((item) => item.guid === 'soon'
        ? { ...item, title: '重新安排报价说明', dueAt: '2026-10-06T02:00:00.000Z' }
        : item),
    };
    const second = await service.analyze({
      ...input,
      now: new Date('2026-10-01T04:00:00.000Z'),
      referenceDate: '2026-10-01',
    });
    expect(second.changes).toEqual([
      expect.objectContaining({
        guid: 'soon',
        kind: 'changed',
        previousTitle: '准备报价说明',
        currentTitle: '重新安排报价说明',
        previousStatus: 'todo',
        currentStatus: 'todo',
      }),
    ]);
  });

  it('reads a linked task detail to identify completion and reopening evidence', async (): Promise<void> => {
    const store: MemoryControlStore = new MemoryControlStore([integration]);
    await saveSucceeded(store, 'detail-action', { taskGuid: 'detail-guid' });
    let detail: DailyReportTaskRecord = {
      guid: 'detail-guid', title: '完成回访', status: 'completed',
      completedAt: '2026-09-30T03:00:00.000Z',
      dueAt: '2026-09-29T02:00:00.000Z', url: 'https://example.com/detail',
    };
    const tasks: TaskFulfillmentTasksReader = {
      listOwnedTasks: async (): Promise<DailyReportTaskResult> => ({ items: [] }),
      getTaskByGuid: async (): Promise<DailyReportTaskRecord> => detail,
    };
    const service: TaskFulfillmentService = new TaskFulfillmentService(tasks, store);
    const input = {
      integration, actorOpenId: 'ou_sales_a', referenceDate: '2026-09-30',
      timezone: 'Asia/Shanghai', now: NOW,
    };
    const completed = await service.analyze(input);
    expect(completed.status).toBe('ready');
    expect(completed.promises[0]).toMatchObject({
      status: 'completed',
      taskStatus: 'completed',
      taskCompletedAt: '2026-09-30T03:00:00.000Z',
    });
    detail = {
      ...detail, title: '重新打开回访', status: 'todo',
      completedAt: null,
      dueAt: '2026-10-02T02:00:00.000Z',
    };
    const reopened = await service.analyze({
      ...input,
      now: new Date('2026-10-01T04:00:00.000Z'),
      referenceDate: '2026-10-01',
    });
    expect(reopened.promises[0]).toMatchObject({ status: 'open_changed' });
    expect(reopened.changes).toEqual([
      expect.objectContaining({
        guid: 'detail-guid',
        kind: 'reopened',
        previousCompletedAt: '2026-09-30T03:00:00.000Z',
        currentCompletedAt: null,
      }),
    ]);
  });

  it('uses an exact observed completion event when the task is no longer visible', async (): Promise<void> => {
    const store: MemoryControlStore = new MemoryControlStore([integration]);
    await saveSucceeded(store, 'historical-action', {
      taskGuid: 'historical-guid',
    });
    let openResult: DailyReportTaskResult = {
      items: [{
        guid: 'historical-guid', title: '准备客户回访', status: 'todo',
        completedAt: null, dueAt: '2026-10-02T02:00:00.000Z', url: null,
      }],
    };
    let completedResult: DailyReportTaskResult = { items: [] };
    const tasks: TaskFulfillmentTasksReader = {
      listOwnedTasks: async (): Promise<DailyReportTaskResult> => openResult,
      listCompletedTasks: async (): Promise<DailyReportTaskResult> =>
        completedResult,
    };
    const service: TaskFulfillmentService = new TaskFulfillmentService(tasks, store);
    const input = {
      integration, actorOpenId: 'ou_sales_a', referenceDate: '2026-09-30',
      timezone: 'Asia/Shanghai', now: NOW,
    };
    await service.analyze(input);
    openResult = { items: [] };
    completedResult = {
      items: [{
        guid: 'historical-guid', title: '准备客户回访', status: 'completed',
        completedAt: '2026-09-30T03:00:00.000Z',
        dueAt: '2026-10-02T02:00:00.000Z', url: null,
      }],
    };
    await service.analyze({
      ...input,
      now: new Date('2026-10-01T04:00:00.000Z'),
      referenceDate: '2026-10-01',
    });
    completedResult = { items: [] };
    const historical = await service.analyze({
      ...input,
      now: new Date('2026-10-02T04:00:00.000Z'),
      referenceDate: '2026-10-02',
    });
    expect(historical.promises[0]).toMatchObject({
      status: 'completed',
      completionState: 'completed',
      taskGuid: 'historical-guid',
      taskCompletedAt: '2026-09-30T03:00:00.000Z',
    });
    expect(historical.changes).toEqual([
      expect.objectContaining({
        guid: 'historical-guid',
        kind: 'completed',
      }),
    ]);
  });

  it('uses an exact reopened event when the task is no longer visible', async (): Promise<void> => {
    const store: MemoryControlStore = new MemoryControlStore([integration]);
    await saveSucceeded(store, 'reopened-history-action', {
      taskGuid: 'reopened-history-guid',
    });
    let current: DailyReportTaskResult = {
      items: [{
        guid: 'reopened-history-guid', title: '确认采购预算', status: 'todo',
        completedAt: null, dueAt: '2026-10-02T02:00:00.000Z', url: null,
      }],
    };
    let completed: DailyReportTaskResult = { items: [] };
    const tasks: TaskFulfillmentTasksReader = {
      listOwnedTasks: async (): Promise<DailyReportTaskResult> => current,
      listCompletedTasks: async (): Promise<DailyReportTaskResult> => completed,
    };
    const service: TaskFulfillmentService = new TaskFulfillmentService(tasks, store);
    const input = {
      integration, actorOpenId: 'ou_sales_a', referenceDate: '2026-09-30',
      timezone: 'Asia/Shanghai', now: NOW,
    };
    await service.analyze(input);
    current = { items: [] };
    completed = {
      items: [{
        guid: 'reopened-history-guid', title: '确认采购预算', status: 'completed',
        completedAt: '2026-09-30T03:00:00.000Z', dueAt: null, url: null,
      }],
    };
    await service.analyze({
      ...input,
      now: new Date('2026-10-01T04:00:00.000Z'),
      referenceDate: '2026-10-01',
    });
    current = {
      items: [{
        guid: 'reopened-history-guid', title: '重新确认采购预算', status: 'todo',
        completedAt: null, dueAt: '2026-10-05T02:00:00.000Z', url: null,
      }],
    };
    completed = { items: [] };
    await service.analyze({
      ...input,
      now: new Date('2026-10-02T04:00:00.000Z'),
      referenceDate: '2026-10-02',
    });
    current = { items: [] };
    const historical = await service.analyze({
      ...input,
      now: new Date('2026-10-03T04:00:00.000Z'),
      referenceDate: '2026-10-03',
    });
    expect(historical.promises[0]).toMatchObject({
      status: 'open_changed',
      completionState: 'still_open',
      taskTitle: '重新确认采购预算',
    });
    expect(historical.changes).toEqual([
      expect.objectContaining({
        guid: 'reopened-history-guid',
        kind: 'reopened',
      }),
    ]);
  });

  it('fails closed when a newer ordinary event follows completion', async (): Promise<void> => {
    const store: MemoryControlStore = new MemoryControlStore([integration]);
    await saveSucceeded(store, 'stale-completion-action', {
      taskGuid: 'stale-completion-guid',
    });
    let current: DailyReportTaskResult = {
      items: [{
        guid: 'stale-completion-guid', title: '准备客户回访', status: 'todo',
        completedAt: null, dueAt: '2026-10-02T02:00:00.000Z', url: null,
      }],
    };
    const tasks: TaskFulfillmentTasksReader = {
      listOwnedTasks: async (): Promise<DailyReportTaskResult> => current,
    };
    const service: TaskFulfillmentService = new TaskFulfillmentService(tasks, store);
    const input = {
      integration, actorOpenId: 'ou_sales_a', referenceDate: '2026-09-30',
      timezone: 'Asia/Shanghai', now: NOW,
    };

    await service.analyze(input);
    current = {
      items: [{
        guid: 'stale-completion-guid', title: '完成客户回访', status: 'completed',
        completedAt: '2026-10-01T02:00:00.000Z', dueAt: null, url: null,
      }],
    };
    await service.analyze({
      ...input,
      now: new Date('2026-10-01T04:00:00.000Z'),
      referenceDate: '2026-10-01',
    });
    current = {
      items: [{
        guid: 'stale-completion-guid', title: '完成客户回访（补充说明）',
        status: 'completed', completedAt: '2026-10-01T02:00:00.000Z',
        dueAt: '2026-10-04T02:00:00.000Z', url: null,
      }],
    };
    await service.analyze({
      ...input,
      now: new Date('2026-10-02T04:00:00.000Z'),
      referenceDate: '2026-10-02',
    });
    current = { items: [] };

    const historical = await service.analyze({
      ...input,
      now: new Date('2026-10-03T04:00:00.000Z'),
      referenceDate: '2026-10-03',
    });

    expect(historical.promises[0]).toMatchObject({
      status: 'task_lookup_unavailable',
      completionState: 'unknown',
      taskGuid: 'stale-completion-guid',
    });
    expect(historical.promises[0].taskTitle).toBeNull();
  });

  it('fails closed when task event history cannot be read', async (): Promise<void> => {
    const store: MemoryControlStore = new MemoryControlStore([integration]);
    await saveSucceeded(store, 'event-history-failure', {
      taskGuid: 'event-history-missing',
    });
    vi.spyOn(store, 'listTaskStatusEvents').mockRejectedValueOnce(
      new Error('event history unavailable'),
    );
    const tasks: TaskFulfillmentTasksReader = {
      listOwnedTasks: async (): Promise<DailyReportTaskResult> => ({ items: [] }),
      listCompletedTasks: async (): Promise<DailyReportTaskResult> => ({ items: [] }),
    };
    const report = await new TaskFulfillmentService(tasks, store).analyze({
      integration, actorOpenId: 'ou_sales_a', referenceDate: '2026-09-30',
      timezone: 'Asia/Shanghai', now: NOW,
    });
    expect(report.promises[0]).toMatchObject({
      status: 'task_lookup_unavailable',
      completionState: 'unknown',
    });
    expect(report.warnings).toContain(
      '任务状态历史暂时不可读取，部分承诺待核实',
    );
  });

  it('classifies visible in-progress tasks as partially completed', async (): Promise<void> => {
    const store: MemoryControlStore = new MemoryControlStore([integration]);
    await saveSucceeded(store, 'partial-action', { taskGuid: 'partial-guid' });
    const tasks: TaskFulfillmentTasksReader = {
      listOwnedTasks: async (): Promise<DailyReportTaskResult> => ({ items: [] }),
      getTaskByGuid: async (): Promise<DailyReportTaskRecord> => ({
        guid: 'partial-guid', title: '整理试点反馈', status: 'in_progress',
        dueAt: '2026-10-02T02:00:00.000Z', url: null,
      }),
    };
    const report = await new TaskFulfillmentService(tasks, store).analyze({
      integration, actorOpenId: 'ou_sales_a', referenceDate: '2026-09-30',
      timezone: 'Asia/Shanghai', now: NOW,
    });

    expect(report.promises[0]).toMatchObject({
      status: 'open_scheduled', completionState: 'partially_completed',
    });
    expect(report.metrics).toMatchObject({
      partiallyCompletedPromiseCount: 1, stillOpenPromiseCount: 0,
    });
  });

  it('shows completed search results and reconciles exact linked promises', async (): Promise<void> => {
    const store: MemoryControlStore = new MemoryControlStore([integration]);
    await saveSucceeded(store, 'completed-action', { taskGuid: 'done-guid' });
    await saveSucceeded(store, 'untracked-action', {}, makePayload('寄送资料'));
    const tasks: TaskFulfillmentTasksReader = {
      listOwnedTasks: async (): Promise<DailyReportTaskResult> => ({ items: [] }),
      listCompletedTasks: async (): Promise<DailyReportTaskResult> => ({
        items: [{
          guid: 'done-guid', title: '准备报价说明', status: 'completed',
          completedAt: '2026-09-30T03:00:00.000Z', dueAt: null,
          url: 'https://example.com/done',
        }],
      }),
      getTaskByGuid: vi.fn(),
    };
    const report = await new TaskFulfillmentService(tasks, store).analyze({
      integration, actorOpenId: 'ou_sales_a', referenceDate: '2026-09-30',
      timezone: 'Asia/Shanghai', now: NOW,
    });

    expect(report.status).toBe('ready');
    expect(report.coverage.completedTasks).toBe('search_scope');
    expect(report.metrics.completedTaskCount).toBe(1);
    expect(report.completedItems).toEqual([{
      guid: 'done-guid', title: '准备报价说明',
      completedAt: '2026-09-30T03:00:00.000Z', dueAt: null,
      url: 'https://example.com/done',
    }]);
    expect(report.promises.find((item) => item.pendingActionId === 'completed-action'))
      .toMatchObject({ status: 'completed', completionState: 'completed' });
    expect(report.promises.find((item) => item.pendingActionId === 'untracked-action'))
      .toMatchObject({ status: 'not_task_tracked', completionState: 'unknown' });
    expect(tasks.getTaskByGuid).not.toHaveBeenCalled();
  });

  it('keeps partial completed history and invalid completion evidence visible', async (): Promise<void> => {
    const tasks: TaskFulfillmentTasksReader = {
      listOwnedTasks: async (): Promise<DailyReportTaskResult> => ({ items: [] }),
      listCompletedTasks: async (): Promise<DailyReportTaskResult> => ({
        items: [{
          guid: 'ambiguous', title: '无完成时间', status: 'todo',
          completedAt: null, dueAt: null, url: null,
        }],
        warning: 'task_query_scope_limited',
      }),
    };
    const report = await new TaskFulfillmentService(
      tasks, new MemoryControlStore([integration]),
    ).analyze({
      integration, actorOpenId: 'ou_sales_a', referenceDate: '2026-09-30',
      timezone: 'Asia/Shanghai', now: NOW,
    });
    expect(report.status).toBe('partial');
    expect(report.coverage.completedTasks).toBe('partial');
    expect(report.completedItems).toEqual([]);
    expect(report.warnings).toContain('已完成任务检索范围受限，结果可能不完整');
    expect(report.warnings).toContain('部分已完成任务缺少有效完成时间，未计入');
  });
});
