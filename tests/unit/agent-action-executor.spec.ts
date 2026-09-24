import { describe, expect, it, vi } from 'vitest';

import type {
  AgentExecutionResult,
  JsonObject,
} from '@shared/api.interface';
import type { AgentRuntimeConfig } from '@server/config/agent.config';
import { AgentActionExecutorService } from '@server/modules/agent-core/agent-action-executor.service';
import { MemoryControlStore } from '@server/modules/agent-core/memory-control.store';
import type {
  FeishuMessenger,
  SalesRecordsGateway,
  TaskGateway,
} from '@server/modules/agent-core/agent.ports';
import type {
  PendingAction,
  SalesRecordResult,
  TaskCreationResult,
  TenantIntegration,
} from '@server/modules/agent-core/agent.types';
import { FollowupProjectRiskService } from '@server/modules/insight/followup-project-risk.service';

const TENANT_ID = '00000000-0000-4000-8000-00000000000a';

const integration: TenantIntegration = {
  tenantId: TENANT_ID,
  feishuTenantKey: 'tenant-a',
  name: '企业 A',
  status: 'active',
  appId: 'cli_test',
  appSecretEnv: 'TEST_APP_SECRET',
  appType: 'selfBuild',
  base: {
    appToken: 'base',
    customers: {
      tableId: 'customers',
      primaryField: '客户',
      fields: { customerName: '客户' },
    },
    opportunities: {
      tableId: 'opportunities',
      primaryField: '商机',
      fields: { opportunityName: '商机', customerLink: '客户' },
    },
    followups: {
      tableId: 'followups',
      primaryField: '跟进',
      fields: {
        sourceMessageId: '来源',
        customerLink: '客户',
        opportunityLink: '商机',
        rawText: '原文',
        summary: '摘要',
      },
    },
  },
};

const execute = async (
  selectedTaskCandidateIds: string[] | undefined,
): Promise<{
  order: string[];
  tasks: TaskGateway;
  result: AgentExecutionResult;
}> => {
  const order: string[] = [];
  const store = new MemoryControlStore([integration]);
  const messenger = {
    sendText: vi.fn(),
    sendConfirmationCard: vi.fn(),
    updateCard: vi.fn(async (
      _integration: TenantIntegration,
      _callbackToken: string,
      _card: JsonObject,
    ): Promise<void> => undefined),
  } as unknown as FeishuMessenger;
  const records = {
    upsertCustomer: vi.fn(async (): Promise<SalesRecordResult> => {
      order.push('customer');
      return {
        recordId: 'rec-customer',
        recordUrl: 'https://base.example/customers/rec-customer',
      };
    }),
    upsertOpportunity: vi.fn(async (): Promise<SalesRecordResult> => {
      order.push('opportunity');
      return {
        recordId: 'rec-opportunity',
        recordUrl: 'https://base.example/opportunities/rec-opportunity',
      };
    }),
    createFollowup: vi.fn(async (): Promise<SalesRecordResult> => {
      order.push('followup');
      return {
        recordId: 'rec-followup',
        recordUrl: 'https://base.example/followups/rec-followup',
      };
    }),
  } as unknown as SalesRecordsGateway;
  const tasks = {
    createTask: vi.fn(async (): Promise<TaskCreationResult> => {
      order.push('task');
      return { guid: 'task-guid', url: 'https://task.example/task-guid' };
    }),
  } as unknown as TaskGateway;
  const payload = {
    version: 1 as const,
    sourceMessageId: 'message-1',
    rawText: '北辰制造客户认可方案。',
    draft: {
      customerName: '北辰制造',
      contactName: '张总',
      opportunityName: '试点项目',
      summary: '客户认可方案',
      customerNeeds: [],
      objections: [],
      risks: [],
      progress: '方案认可',
      expectedAmount: null,
      nextAction: '发送实施计划',
      dueAt: '2026-09-20T18:00:00+08:00',
      evidenceQuotes: ['客户认可方案'],
    },
    ...(selectedTaskCandidateIds === undefined
      ? {}
      : { selectedTaskCandidateIds }),
  };
  const action: PendingAction = await store.createPendingAction({
    id: `action-${selectedTaskCandidateIds?.length ?? 'legacy'}`,
    tenantId: TENANT_ID,
    actorOpenId: 'ou_owner',
    chatId: 'oc_chat',
    payload,
    expiresAt: new Date('2026-09-21T18:00:00+08:00'),
  });
  const executor = new AgentActionExecutorService(
    store,
    messenger,
    records,
    tasks,
    new FollowupProjectRiskService(),
  );

  const result: AgentExecutionResult = await executor.executeImmediately(
    integration,
    action,
    'trace-executor',
  );
  return { order, tasks, result };
};

describe('AgentActionExecutorService task selection', (): void => {
  it('writes all Base records and skips Task when the user selected none', async (): Promise<void> => {
    const result = await execute([]);
    expect(result.order).toEqual(['customer', 'opportunity', 'followup']);
    expect(result.tasks.createTask).not.toHaveBeenCalled();
  });

  it('creates Task only after all Base writes when a candidate was selected', async (): Promise<void> => {
    const result = await execute(['draft-1:v1:task:0']);
    expect(result.order).toEqual([
      'customer',
      'opportunity',
      'followup',
      'task',
    ]);
    expect(result.tasks.createTask).toHaveBeenCalledTimes(1);
  });

  it('keeps legacy P0 actions without a selection field compatible', async (): Promise<void> => {
    const result = await execute(undefined);
    expect(result.order.at(-1)).toBe('task');
    expect(result.tasks.createTask).toHaveBeenCalledTimes(1);
  });

  it('persists Base record URLs in the execution result', async (): Promise<void> => {
    const execution = await execute([]);

    expect(execution.result.customerRecordUrl)
      .toBe('https://base.example/customers/rec-customer');
    expect(execution.result.opportunityRecordUrl)
      .toBe('https://base.example/opportunities/rec-opportunity');
    expect(execution.result.followupRecordUrl)
      .toBe('https://base.example/followups/rec-followup');
  });
});

describe('AgentActionExecutorService execution timeout', (): void => {
  it('turns a hung external write into a retryable terminal failure', async (): Promise<void> => {
    const store = new MemoryControlStore([integration]);
    const messenger = {
      updateCard: vi.fn(async (): Promise<void> => undefined),
    } as unknown as FeishuMessenger;
    const records = {
      upsertCustomer: vi.fn(async (): Promise<SalesRecordResult> =>
        new Promise<SalesRecordResult>(() => undefined)),
    } as unknown as SalesRecordsGateway;
    const tasks = {} as unknown as TaskGateway;
    const config: AgentRuntimeConfig = {
      host: '127.0.0.1',
      port: 3100,
      databaseUrl: 'postgres://unused',
      executionTimeoutMs: 10,
      llm: { baseUrl: 'https://llm.test/v1', apiKey: 'key', model: 'model' },
      feishu: { verificationToken: 'token', encryptKey: undefined },
    };
    const action: PendingAction = await store.createPendingAction({
      id: 'action-timeout',
      tenantId: TENANT_ID,
      actorOpenId: 'ou_owner',
      chatId: 'oc_chat',
      payload: {
        version: 1,
        sourceMessageId: 'message-timeout',
        rawText: '客户等待方案。',
        draft: {
          customerName: '北辰制造',
          contactName: null,
          opportunityName: null,
          summary: '等待方案',
          customerNeeds: [],
          objections: [],
          risks: [],
          progress: null,
          expectedAmount: null,
          nextAction: '发送方案',
          dueAt: '2026-10-01T10:00:00+08:00',
          evidenceQuotes: [],
        },
      },
      expiresAt: new Date(Date.now() + 60_000),
    });
    const executor = new AgentActionExecutorService(
      store,
      messenger,
      records,
      tasks,
      new FollowupProjectRiskService(),
      config,
    );

    const result: AgentExecutionResult = await executor.executeImmediately(
      integration,
      action,
      'trace-timeout',
    );

    expect(result).toMatchObject({
      status: 'failed',
      errorCode: 'EXECUTION_TIMEOUT',
    });
    await expect(store.getPendingAction(TENANT_ID, action.id))
      .resolves.toMatchObject({
        status: 'failed',
        result: { errorCode: 'EXECUTION_TIMEOUT' },
      });
  });
});

interface MessagingExecutionState {
  sourceCalls: number;
  resultCalls: number;
  riskCalls: number;
  sourceCard?: JsonObject;
  result?: AgentExecutionResult;
}

interface MessagingExecutionResult {
  action: PendingAction;
  order: string[];
  state: MessagingExecutionState;
  store: MemoryControlStore;
}

const executeWithMessaging = async (
  rawText: string,
  riskSendFails: boolean = false,
  sourceUpdateFails: boolean = false,
): Promise<MessagingExecutionResult> => {
  const order: string[] = [];
  const state: MessagingExecutionState = {
    sourceCalls: 0,
    resultCalls: 0,
    riskCalls: 0,
  };
  const store: MemoryControlStore = new MemoryControlStore([integration]);
  const messenger = {
    sendText: vi.fn(),
    sendConfirmationCard: vi.fn(),
    updateCard: vi.fn(async (
      _integration: TenantIntegration,
      _messageId: string,
      card: JsonObject,
    ): Promise<void> => {
      order.push('source-card');
      state.sourceCalls += 1;
      state.sourceCard = structuredClone(card);
      if (sourceUpdateFails) {
        throw new Error('Injected source card update failure');
      }
    }),
    sendResultCard: vi.fn(async (
      _integration: TenantIntegration,
      _chatId: string,
      _action: PendingAction,
      result: AgentExecutionResult,
    ): Promise<string> => {
      order.push('result-card');
      state.resultCalls += 1;
      state.result = structuredClone(result);
      return 'om_result';
    }),
    sendProjectRiskCard: vi.fn(async (): Promise<string> => {
      order.push('risk-card');
      state.riskCalls += 1;
      if (riskSendFails) throw new Error('Injected risk card failure');
      return 'om_risk';
    }),
  } as unknown as FeishuMessenger;
  const records = {
    upsertCustomer: vi.fn(async (): Promise<SalesRecordResult> => {
      order.push('customer');
      return {
        recordId: 'rec-customer',
        recordUrl: 'https://base.example/customers/rec-customer',
      };
    }),
    upsertOpportunity: vi.fn(async (): Promise<SalesRecordResult> => {
      order.push('opportunity');
      return {
        recordId: 'rec-opportunity',
        recordUrl: 'https://base.example/opportunities/rec-opportunity',
      };
    }),
    createFollowup: vi.fn(async (): Promise<SalesRecordResult> => {
      order.push('followup');
      return {
        recordId: 'rec-followup',
        recordUrl: 'https://base.example/followups/rec-followup',
      };
    }),
  } as unknown as SalesRecordsGateway;
  const tasks = {
    createTask: vi.fn(async (): Promise<TaskCreationResult> => {
      order.push('task');
      return { guid: 'task-guid', url: 'https://task.example/task-guid' };
    }),
  } as unknown as TaskGateway;
  const createdAction: PendingAction = await store.createPendingAction({
    id: 'action-messaging',
    tenantId: TENANT_ID,
    actorOpenId: 'ou_owner',
    chatId: 'oc_chat',
    payload: {
      version: 1,
      sourceMessageId: 'message-risk',
      rawText,
      draft: {
        customerName: '北辰制造',
        contactName: '张总',
        opportunityName: '试点项目',
        summary: '项目沟通',
        customerNeeds: [],
        objections: [],
        risks: [],
        progress: '方案沟通',
        expectedAmount: null,
        nextAction: '安排技术交流',
        dueAt: '2026-09-22T14:00:00+08:00',
        evidenceQuotes: [],
      },
      selectedTaskCandidateIds: ['candidate-1'],
    },
    expiresAt: new Date('2026-09-23T00:00:00+08:00'),
  });
  await store.setPendingCardMessage(
    TENANT_ID,
    createdAction.id,
    'om_source_card',
  );
  const action: PendingAction | null = await store.getPendingAction(
    TENANT_ID,
    createdAction.id,
  );
  if (action === null) throw new Error('Expected pending action with card');
  const executor: AgentActionExecutorService = new AgentActionExecutorService(
    store,
    messenger,
    records,
    tasks,
    new FollowupProjectRiskService(),
  );

  executor.schedule(
    integration,
    action,
    'callback-token',
    'trace-messaging',
  );
  const expectsRisk: boolean = rawText.includes('暂停');
  for (let attempt: number = 0; attempt < 50; attempt += 1) {
    const enoughCalls: boolean =
      state.sourceCalls >= 2 &&
      (sourceUpdateFails ? state.resultCalls === 1 : true) &&
      (expectsRisk ? state.riskCalls === 1 : true);
    if (enoughCalls) break;
    await new Promise<void>((resolve: () => void): void => {
      setTimeout(resolve, 5);
    });
  }
  await new Promise<void>((resolve: () => void): void => {
    setTimeout(resolve, 5);
  });
  const saved: PendingAction | null = await store.getPendingAction(
    TENANT_ID,
    action.id,
  );
  if (saved === null) throw new Error('Expected saved pending action');
  return { action: saved, order, state, store };
};

describe('AgentActionExecutorService conditional risk card', (): void => {
  it('finalizes the original card before the evidenced project risk card', async (): Promise<void> => {
    const execution: MessagingExecutionResult = await executeWithMessaging(
      '客户明确表示项目暂停推进。张总正在对比竞品甲。',
    );

    expect(execution.order).toEqual([
      'source-card',
      'customer',
      'opportunity',
      'followup',
      'task',
      'source-card',
      'risk-card',
    ]);
    expect(execution.state.resultCalls).toBe(0);
  });

  it('shows exactly one success card for an ordinary followup', async (): Promise<void> => {
    const execution: MessagingExecutionResult = await executeWithMessaging(
      '客户认可试点方案，下一步安排技术交流。',
    );

    expect(execution.state.sourceCalls).toBe(2);
    expect(execution.state.resultCalls).toBe(0);
    expect(execution.state.riskCalls).toBe(0);
    expect(JSON.stringify(execution.state.sourceCard))
      .toContain('跟进登记成功');
    expect(execution.action.result.followupRecordUrl)
      .toBe('https://base.example/followups/rec-followup');
    expect(execution.store.getAudits(TENANT_ID)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          eventType: 'card.source_finalized',
          outcome: 'succeeded',
        }),
      ]),
    );
    expect(execution.store.getAudits(TENANT_ID).some(
      (event): boolean => event.eventType === 'card.result_sent',
    )).toBe(false);
  });

  it('sends one fallback result card when the source card cannot update', async (): Promise<void> => {
    const execution: MessagingExecutionResult = await executeWithMessaging(
      '客户认可试点方案，下一步安排技术交流。',
      false,
      true,
    );

    expect(execution.order).toEqual([
      'source-card',
      'customer',
      'opportunity',
      'followup',
      'task',
      'source-card',
      'result-card',
    ]);
    expect(execution.state.resultCalls).toBe(1);
  });

  it('keeps successful Base and Task writes when risk card delivery fails', async (): Promise<void> => {
    const execution: MessagingExecutionResult = await executeWithMessaging(
      '客户明确表示项目暂停推进。',
      true,
    );

    expect(execution.order.indexOf('source-card'))
      .toBeLessThan(execution.order.indexOf('risk-card'));
    expect(execution.action.status).toBe('succeeded');
    expect(execution.action.result.followupRecordId).toBe('rec-followup');
    expect(execution.action.result.taskGuid).toBe('task-guid');
    expect(execution.store.getAudits(TENANT_ID).some(
      (event): boolean =>
        event.eventType === 'card.project_risk_send_failed',
    )).toBe(true);
  });
});
