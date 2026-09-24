import { describe, expect, it, vi } from 'vitest';

import type {
  AgentExecutionResult,
  FollowupDraft,
  FollowupMissingField,
  JsonObject,
} from '@shared/api.interface';
import { AgentWorkflowService } from '@server/modules/agent-core/agent-workflow.service';
import { AgentActionExecutorService } from '@server/modules/agent-core/agent-action-executor.service';
import { createConfirmationCard } from '@server/modules/agent-core/agent.cards';
import { MemoryControlStore } from '@server/modules/agent-core/memory-control.store';
import { FollowupChatDraftService } from '@server/modules/sales-behavior/followup-chat-draft.service';
import { FollowupQualityService } from '@server/modules/sales-behavior/followup-quality.service';
import {
  FollowupProjectRiskService,
} from '@server/modules/insight/followup-project-risk.service';
import type { PlatformSessionService } from '@server/modules/platform-shell/platform-session.service';
import type {
  ConversationAssistant,
  FeishuMessenger,
  FollowupExtractor,
  SalesRecordsGateway,
  TaskGateway,
} from '@server/modules/agent-core/agent.ports';
import type {
  ConversationDecision,
  ConversationInput,
  FollowupExtractionInput,
  IncomingCardAction,
  IncomingMessage,
  PendingAction,
  SalesRecordResult,
  TaskCreationResult,
  TenantIntegration,
} from '@server/modules/agent-core/agent.types';

const completeDraft: FollowupDraft = {
  customerName: '北辰制造',
  contactName: '张总',
  opportunityName: '北辰数字化项目',
  summary: '客户认可方案，要求补充实施计划。',
  customerNeeds: ['实施计划'],
  objections: [],
  risks: ['采购周期待确认'],
  progress: '方案已认可',
  expectedAmount: 500000,
  nextAction: '发送实施计划',
  dueAt: '2026-09-20T10:00:00+08:00',
  evidenceQuotes: ['客户认可方案'],
  nextActionChannel: '邮件',
  nextActionParticipants: ['张总'],
};

const createIntegration = (
  tenantId: string,
  tenantKey: string,
): TenantIntegration => ({
  tenantId,
  feishuTenantKey: tenantKey,
  name: tenantId,
  status: 'active',
  appId: 'cli_test',
  appSecretEnv: 'TEST_APP_SECRET',
  appType: 'selfBuild',
  base: {
    appToken: `base_${tenantId}`,
    customers: {
      tableId: 'tbl_customers',
      primaryField: '客户名称',
      fields: {
        customerName: '客户名称',
      },
    },
    opportunities: {
      tableId: 'tbl_opportunities',
      primaryField: '商机名称',
      fields: {
        opportunityName: '商机名称',
        customerLink: '关联客户',
      },
    },
    followups: {
      tableId: 'tbl_followups',
      primaryField: '跟进标题',
      fields: {
        sourceMessageId: '来源消息ID',
        customerLink: '关联客户',
        opportunityLink: '关联商机',
        rawText: '原文',
        summary: '摘要',
      },
    },
  },
});

class FixedExtractor implements FollowupExtractor {
  lastInput: FollowupExtractionInput | null = null;
  calls: number = 0;
  failNext: boolean = false;

  constructor(private readonly draft: FollowupDraft) {}

  async extract(input: FollowupExtractionInput): Promise<FollowupDraft> {
    this.calls += 1;
    this.lastInput = structuredClone(input);
    if (this.failNext) {
      this.failNext = false;
      throw new Error('Injected generation failure');
    }
    return structuredClone(this.draft);
  }

  getMissingFields(draft: FollowupDraft): FollowupMissingField[] {
    const missing: FollowupMissingField[] = [];
    if (!draft.customerName) {
      missing.push('customerName');
    }
    if (!draft.nextAction) {
      missing.push('nextAction');
    }
    if (!draft.dueAt) {
      missing.push('dueAt');
    }
    return missing;
  }
}

class FakeConversationAssistant implements ConversationAssistant {
  calls: number = 0;
  readonly inputs: ConversationInput[] = [];
  nextDecision: ConversationDecision | null = null;
  nextResponse: Promise<ConversationDecision> | null = null;
  failNext: boolean = false;

  async respond(input: ConversationInput): Promise<ConversationDecision> {
    this.calls += 1;
    this.inputs.push(structuredClone(input));
    if (this.failNext) {
      this.failNext = false;
      throw new Error('Injected conversation failure');
    }
    if (this.nextResponse) return this.nextResponse;
    if (this.nextDecision !== null) return this.nextDecision;
    if (input.context?.activeWorkflow === 'record_or_analyze') {
      if (input.text.includes('写跟进') || input.text.includes('记录')) {
        return this.decision('followup_capture', '我会整理成待确认的跟进草案。');
      }
      if (input.text.includes('分析')) {
        return this.decision('followup_analyze', '这段沟通需要继续确认客户的采购条件。');
      }
    }
    if (
      input.text.includes('写跟进') ||
      input.text.includes('记录跟进')
    ) {
      return this.decision('followup_capture', '我会整理成待确认的跟进草案。');
    }
    if (input.text === '你好') {
      return this.decision('general_chat', '你好，我是你的销售助手。');
    }
    if (input.text.includes('压价')) {
      return this.decision(
        'sales_qa',
        '面对压价，先确认价格异议背后的预算、价值和决策条件。',
      );
    }
    if (input.text.includes('邮件')) {
      return this.decision(
        'content_generate',
        '邮件草稿：您好，想和您确认一下当前方案的意见与下一步安排。',
      );
    }
    if (input.text.includes('最近进展')) {
      return this.decision(
        'business_query',
        '我暂时还没有接通客户查询，不能编造北辰制造的进展。',
      );
    }
    return this.decision(
      'ambiguous',
      '你希望我把这句话记录为跟进，还是只分析它对商机的影响？',
    );
  }

  private decision(
    intent: ConversationDecision['intent'],
    reply: string,
  ): ConversationDecision {
    return {
      schemaVersion: 'conversation-intent-v1',
      intent,
      confidence: 0.95,
      reply,
    };
  }
}

class FakeMessenger implements FeishuMessenger {
  readonly texts: string[] = [];
  readonly textUpdates: Array<{ messageId: string; text: string }> = [];
  readonly actions: PendingAction[] = [];
  readonly updates: JsonObject[] = [];
  readonly updateMessageIds: string[] = [];
  readonly results: AgentExecutionResult[] = [];
  readonly projectRiskCards: number[] = [];
  failNextUpdate: boolean = false;
  failNextTextUpdate: boolean = false;
  failNextTextSend: boolean = false;

  async sendText(
    _integration: TenantIntegration,
    _chatId: string,
    text: string,
    _idempotencyKey: string,
  ): Promise<string> {
    if (this.failNextTextSend) {
      this.failNextTextSend = false;
      throw new Error('Injected text send failure');
    }
    this.texts.push(text);
    return `om_text_${this.texts.length}`;
  }

  async updateText(
    _integration: TenantIntegration,
    messageId: string,
    text: string,
  ): Promise<void> {
    if (this.failNextTextUpdate) {
      this.failNextTextUpdate = false;
      throw new Error('Injected text edit failure');
    }
    this.textUpdates.push({ messageId, text });
    const index: number = Number(messageId.replace('om_text_', '')) - 1;
    this.texts[index] = text;
  }

  async sendConfirmationCard(
    _integration: TenantIntegration,
    _chatId: string,
    action: PendingAction,
  ): Promise<string> {
    this.actions.push(structuredClone(action));
    return `om_card_${this.actions.length}`;
  }

  async updateCard(
    _integration: TenantIntegration,
    cardMessageId: string,
    card: JsonObject,
  ): Promise<void> {
    this.updateMessageIds.push(cardMessageId);
    if (this.failNextUpdate) {
      this.failNextUpdate = false;
      throw new Error('Injected card patch failure');
    }
    this.updates.push(structuredClone(card));
  }

  async sendResultCard(
    _integration: TenantIntegration,
    _chatId: string,
    _action: PendingAction,
    result: PendingAction['result'],
  ): Promise<string> {
    this.results.push(structuredClone(result));
    return `om_result_${this.results.length}`;
  }

  async sendProjectRiskCard(): Promise<string> {
    this.projectRiskCards.push(this.projectRiskCards.length + 1);
    return `om_risk_${this.projectRiskCards.length}`;
  }
}

class FakeRecords implements SalesRecordsGateway {
  customerCalls: number = 0;
  opportunityCalls: number = 0;
  followupCalls: number = 0;
  followupUpdateCalls: number = 0;
  failNextCustomer: boolean = false;
  failNextFollowup: boolean = false;

  async upsertCustomer(): Promise<SalesRecordResult> {
    this.customerCalls += 1;
    if (this.failNextCustomer) {
      this.failNextCustomer = false;
      throw new Error('Injected customer failure');
    }
    return {
      recordId: 'rec_customer',
      recordUrl: 'https://base.example/customers/rec_customer',
    };
  }

  async upsertOpportunity(): Promise<SalesRecordResult> {
    this.opportunityCalls += 1;
    return {
      recordId: 'rec_opportunity',
      recordUrl: 'https://base.example/opportunities/rec_opportunity',
    };
  }

  async createFollowup(): Promise<SalesRecordResult> {
    this.followupCalls += 1;
    if (this.failNextFollowup) {
      this.failNextFollowup = false;
      throw new Error('Injected followup failure');
    }
    return {
      recordId: 'rec_followup',
      recordUrl: 'https://base.example/followups/rec_followup',
    };
  }

  async updateFollowup(): Promise<SalesRecordResult> {
    this.followupUpdateCalls += 1;
    return {
      recordId: 'rec_followup',
      recordUrl: 'https://base.example/followups/rec_followup',
    };
  }
}

class FakeTasks implements TaskGateway {
  calls: number = 0;
  updateCalls: number = 0;

  async createTask(): Promise<TaskCreationResult> {
    this.calls += 1;
    return {
      guid: 'task-guid',
      url: 'https://applink.feishu.cn/client/todo/task?guid=task-guid',
    };
  }

  async updateTask(): Promise<TaskCreationResult> {
    this.updateCalls += 1;
    return {
      guid: 'task-guid',
      url: 'https://applink.feishu.cn/client/todo/task?guid=task-guid',
    };
  }
}

interface TestHarness {
  integrationA: TenantIntegration;
  integrationB: TenantIntegration;
  store: MemoryControlStore;
  messenger: FakeMessenger;
  records: FakeRecords;
  tasks: FakeTasks;
  extractor: FixedExtractor;
  conversation: FakeConversationAssistant;
  workflow: AgentWorkflowService;
}

const createHarness = (
  draft: FollowupDraft = completeDraft,
): TestHarness => {
  const integrationA: TenantIntegration = createIntegration(
    '00000000-0000-0000-0000-00000000000a',
    'tenant-a',
  );
  const integrationB: TenantIntegration = createIntegration(
    '00000000-0000-0000-0000-00000000000b',
    'tenant-b',
  );
  const store: MemoryControlStore = new MemoryControlStore([
    integrationA,
    integrationB,
  ]);
  const messenger: FakeMessenger = new FakeMessenger();
  const records: FakeRecords = new FakeRecords();
  const tasks: FakeTasks = new FakeTasks();
  const extractor: FixedExtractor = new FixedExtractor(draft);
  const conversation: FakeConversationAssistant =
    new FakeConversationAssistant();
  const executor: AgentActionExecutorService =
    new AgentActionExecutorService(
      store,
      messenger,
      records,
      tasks,
      new FollowupProjectRiskService(),
    );
  const sessions = {
    getSession: async (): Promise<{
      tenant: { id: string; name: string; timezone: string };
      member: { id: string; feishuOpenId: string; displayName: string };
      roles: ['sales'];
      permissions: ['followup:create-own'];
      navigation: [];
      policyVersion: string;
    }> => ({
      tenant: {
        id: integrationA.tenantId,
        name: integrationA.name,
        timezone: 'Asia/Shanghai',
      },
      member: {
        id: '00000000-0000-4000-8000-00000000000c',
        feishuOpenId: 'ou_sales',
        displayName: '销售',
      },
      roles: ['sales'],
      permissions: ['followup:create-own'],
      navigation: [],
      policyVersion: 'test',
    }),
  } as unknown as PlatformSessionService;
  const chatDrafts = new FollowupChatDraftService(
    sessions,
    new FollowupQualityService(),
  );
  const workflow: AgentWorkflowService = new AgentWorkflowService(
    store,
    extractor,
    conversation,
    messenger,
    executor,
    chatDrafts,
  );
  return {
    integrationA,
    integrationB,
    store,
    messenger,
    records,
    tasks,
    extractor,
    conversation,
    workflow,
  };
};

const createMessage = (
  tenantKey: string = 'tenant-a',
  messageId: string = 'om_source_1',
): IncomingMessage => ({
  feishuTenantKey: tenantKey,
  messageId,
  chatId: `oc_${tenantKey}`,
  chatType: 'p2p',
  messageType: 'text',
  senderOpenId: 'ou_sales',
  senderType: 'user',
  text: '记录跟进：客户认可方案，下一步发送实施计划，截止本周日。',
  receivedAt: new Date('2026-09-17T10:00:00+08:00'),
});

const createCardAction = (
  tenantKey: string,
  actionId: string,
  action: 'confirm' | 'cancel' | 'retry' | 'edit',
  eventId: string,
  receivedAt: Date = new Date('2026-09-17T10:01:00+08:00'),
  cardMessageId: string | null = 'om_card_1',
): IncomingCardAction => ({
  feishuTenantKey: tenantKey,
  eventId,
  operatorOpenId: 'ou_sales',
  callbackToken: `callback-${eventId}`,
  value: {
    action,
    pendingActionId: actionId,
  },
  cardMessageId,
  chatId: `oc_${tenantKey}`,
  actionName: null,
  formValue: {},
  receivedAt,
});

const createDraftFormAction = (
  pending: PendingAction,
  version: number,
  eventId: string,
  edits: JsonObject = {},
  submitAction: 'confirm' | 'review' = 'confirm',
): IncomingCardAction => ({
  feishuTenantKey: 'tenant-a',
  eventId,
  operatorOpenId: 'ou_sales',
  callbackToken: `callback-${eventId}`,
  cardMessageId: 'om_card_1',
  chatId: 'oc_tenant-a',
  actionName: `${submitAction}_followup_v${version}`,
  value: {},
  formValue: {
    generatedBody: pending.payload.generatedBody ?? '',
    customerName: pending.payload.draft.customerName ?? '',
    contactName: pending.payload.draft.contactName ?? '',
    nextAction: pending.payload.draft.nextAction ?? '',
    dueAt: pending.payload.draft.dueAt ?? '',
    nextActionChannel: pending.payload.draft.nextActionChannel ?? '',
    nextActionParticipants:
      (pending.payload.draft.nextActionParticipants ?? []).join('、'),
    task_0: true,
    ...edits,
  },
  receivedAt: new Date('2026-09-17T10:01:00+08:00'),
});

const createIntakeFormAction = (
  eventId: string = 'evt-intake-submit',
  overrides: Partial<IncomingCardAction> = {},
): IncomingCardAction => ({
  feishuTenantKey: 'tenant-a',
  eventId,
  operatorOpenId: 'ou_sales',
  callbackToken: `callback-${eventId}`,
  cardMessageId: 'om_card_1',
  chatId: 'oc_tenant-a',
  actionName: 'submit_followup_input',
  value: {},
  formValue: {
    communicationContent: '张总认可试点方案，要求补充实施计划。',
    customerName: '北辰制造',
    contactName: '张总',
    communicationMethod: '现场拜访',
    communicationAt: '2026-09-20 10:00',
    topic: '试点方案沟通',
    nextAction: '安排技术交流',
    dueAt: '2026-09-22 14:00',
    nextActionChannel: '客户现场',
    nextActionParticipants: '张总、售前王工',
  },
  receivedAt: new Date('2026-09-20T10:01:00+08:00'),
  ...overrides,
});

const waitForStatus = async (
  store: MemoryControlStore,
  tenantId: string,
  actionId: string,
  expected: string,
): Promise<PendingAction> => {
  let observedStatus: string = 'missing';
  for (let attempt: number = 0; attempt < 50; attempt += 1) {
    const current: PendingAction | null = await store.getPendingAction(
      tenantId,
      actionId,
    );
    observedStatus = current?.status ?? 'missing';
    if (current?.status === expected) {
      return current;
    }
    await new Promise<void>((resolve: () => void): void => {
      setTimeout(resolve, 5);
    });
  }
  throw new Error(
    `Action did not reach ${expected}; last status was ${observedStatus}`,
  );
};

const waitForUpdates = async (
  messenger: FakeMessenger,
  expected: number,
): Promise<void> => {
  for (let attempt: number = 0; attempt < 400; attempt += 1) {
    if (messenger.updates.length >= expected) return;
    await new Promise<void>((resolve: () => void): void => {
      setTimeout(resolve, 5);
    });
  }
  throw new Error(`Expected ${expected} card update(s)`);
};

const waitForAudit = async (
  store: MemoryControlStore,
  tenantId: string,
  eventType: string,
): Promise<void> => {
  for (let attempt: number = 0; attempt < 400; attempt += 1) {
    const found: boolean = store.getAudits(tenantId).some(
      (event): boolean => event.eventType === eventType,
    );
    if (found) return;
    await new Promise<void>((resolve: () => void): void => {
      setTimeout(resolve, 5);
    });
  }
  throw new Error(`Expected audit event ${eventType}`);
};

describe('AgentWorkflowService', (): void => {
  it('shows a text waiting state before the model completes and edits it to the answer', async (): Promise<void> => {
    const harness: TestHarness = createHarness();
    let finish: (decision: ConversationDecision) => void = (): void => {};
    harness.conversation.nextResponse = new Promise<ConversationDecision>(
      (resolve: (decision: ConversationDecision) => void): void => {
        finish = resolve;
      },
    );

    const processing: Promise<void> = harness.workflow.handleMessage({
      ...createMessage(),
      text: '你可以帮助我做什么',
    });
    await vi.waitFor((): void => {
      expect(harness.messenger.texts).toEqual(['正在组织回答…']);
    });
    expect(harness.conversation.calls).toBe(1);
    expect(harness.records.followupCalls).toBe(0);

    finish({
      schemaVersion: 'conversation-intent-v1',
      intent: 'general_chat',
      confidence: 0.95,
      reply: '我可以帮你回答销售问题，并在确认后保存跟进。',
    });
    await processing;

    expect(harness.messenger.texts).toEqual([
      '我可以帮你回答销售问题，并在确认后保存跟进。',
    ]);
    expect(harness.messenger.textUpdates).toEqual([{
      messageId: 'om_text_1',
      text: '我可以帮你回答销售问题，并在确认后保存跟进。',
    }]);
    expect(harness.messenger.actions).toHaveLength(0);
    expect(harness.tasks.calls).toBe(0);
  });

  it('turns a model failure into a visible terminal error on the waiting message', async (): Promise<void> => {
    const harness: TestHarness = createHarness();
    harness.conversation.failNext = true;

    await harness.workflow.handleMessage({
      ...createMessage(),
      text: '你可以帮助我做什么',
    });

    expect(harness.messenger.texts).toHaveLength(1);
    expect(harness.messenger.texts[0]).toContain('请稍后再试');
    expect(harness.messenger.textUpdates).toHaveLength(1);
    expect(harness.records.followupCalls).toBe(0);
    expect(harness.tasks.calls).toBe(0);
  });

  it('sends the answer when editing the waiting text fails', async (): Promise<void> => {
    const harness: TestHarness = createHarness();
    harness.messenger.failNextTextUpdate = true;

    await harness.workflow.handleMessage({
      ...createMessage(),
      text: '你好',
    });

    expect(harness.messenger.texts).toEqual([
      '正在组织回答…',
      '你好，我是你的销售助手。',
    ]);
    expect(harness.store.getAudits(harness.integrationA.tenantId)
      .some((event): boolean =>
        event.eventType === 'message.progress_update_failed')).toBe(true);
  });

  it('still answers if the initial waiting text cannot be sent', async (): Promise<void> => {
    const harness: TestHarness = createHarness();
    harness.messenger.failNextTextSend = true;

    await harness.workflow.handleMessage({
      ...createMessage(),
      text: '你好',
    });

    expect(harness.messenger.texts).toEqual([
      '你好，我是你的销售助手。',
    ]);
    expect(harness.messenger.textUpdates).toHaveLength(0);
  });

  it.each([
    ['你好', '你好'],
    ['客户一直压价怎么办？', '压价'],
    ['帮我写一封催客户确认方案的邮件', '邮件'],
    ['北辰制造最近进展怎么样？', '暂时'],
  ])(
    'routes %s as conversation without followup side effects',
    async (text: string, expectedReply: string): Promise<void> => {
      const harness: TestHarness = createHarness();

      await harness.workflow.handleMessage({
        ...createMessage('tenant-a', `om-conversation-${text}`),
        text,
      });

      expect(harness.extractor.calls).toBe(0);
      expect(harness.messenger.actions).toHaveLength(0);
      expect(harness.messenger.texts.at(-1)).toContain(expectedReply);
      expect(harness.records.followupCalls).toBe(0);
      expect(harness.tasks.calls).toBe(0);
    },
  );

  it('clarifies a bare sales fact instead of silently recording it', async (): Promise<void> => {
    const harness: TestHarness = createHarness();

    await harness.workflow.handleMessage({
      ...createMessage(),
      text: '张总说预算下周批',
    });

    expect(harness.extractor.calls).toBe(0);
    expect(harness.messenger.actions).toHaveLength(0);
    expect(harness.messenger.texts.at(-1)).toContain('待确认的跟进记录');
    expect(harness.messenger.texts.at(-1)).toContain('只分析');
  });

  it('persists a scoped intent-clarification session for a bare sales fact', async (): Promise<void> => {
    const harness: TestHarness = createHarness();
    const receivedAt: Date = new Date();
    const originalText: string = '张总说预算下周批';

    await harness.workflow.handleMessage({
      ...createMessage('tenant-a', 'om-clarification-open'),
      text: originalText,
      receivedAt,
    });

    const session = await harness.store.getOpenSession(
      harness.integrationA.tenantId,
      'ou_sales',
    );
    expect(session).toMatchObject({
      chatId: 'oc_tenant-a',
      sourceMessageId: 'om-clarification-open',
      rawText: originalText,
      draft: null,
      state: 'collecting',
    });
    expect(harness.store.getAudits(harness.integrationA.tenantId)
      .some((event): boolean =>
        event.eventType === 'message.intent_clarification_opened.v1'))
      .toBe(true);
  });

  it('routes a normal question through the model while a followup draft is collecting', async (): Promise<void> => {
    const harness: TestHarness = createHarness();
    const receivedAt = new Date('2026-09-24T10:00:00+08:00');
    await harness.store.saveCollectingSession({
      tenantId: harness.integrationA.tenantId,
      actorOpenId: 'ou_sales',
      chatId: 'oc_tenant-a',
      sourceMessageId: 'om-draft-source',
      rawText: '北辰制造要求重新核对报价，下一步周五电话沟通。',
      draft: completeDraft,
      expiresAt: new Date(receivedAt.getTime() + 24 * 60 * 60 * 1_000),
    });
    harness.conversation.nextDecision = {
      schemaVersion: 'conversation-intent-v1',
      intent: 'sales_qa',
      confidence: 0.97,
      reply: '先确认客户压价依据，再按价值与交换条件确定让步空间。',
    };

    await harness.workflow.handleMessage({
      ...createMessage('tenant-a', 'om-question-in-collecting'),
      text: '这次报价应该保留多少余地',
      receivedAt,
    });

    expect(harness.conversation.calls).toBe(1);
    expect(harness.conversation.inputs[0]?.context?.activeWorkflow)
      .toBe('followup_collecting');
    expect(harness.extractor.calls).toBe(0);
    expect(harness.messenger.texts.at(-1)).toContain('让步空间');
    await expect(harness.store.getOpenSession(
      harness.integrationA.tenantId,
      'ou_sales',
    )).resolves.toBeNull();
  });

  it('keeps a related supplement in the active followup flow after model routing', async (): Promise<void> => {
    const harness: TestHarness = createHarness();
    const receivedAt = new Date('2026-09-24T10:00:00+08:00');
    const sourceText = '北辰制造要求重新核对报价。';
    await harness.store.saveCollectingSession({
      tenantId: harness.integrationA.tenantId,
      actorOpenId: 'ou_sales',
      chatId: 'oc_tenant-a',
      sourceMessageId: 'om-supplement-source',
      rawText: sourceText,
      draft: completeDraft,
      expiresAt: new Date(receivedAt.getTime() + 24 * 60 * 60 * 1_000),
    });
    harness.conversation.nextDecision = {
      schemaVersion: 'conversation-intent-v1',
      intent: 'followup_capture',
      confidence: 0.96,
      reply: '这是对当前跟进的补充。',
    };

    await harness.workflow.handleMessage({
      ...createMessage('tenant-a', 'om-related-supplement'),
      text: '客户还说预算最晚下周一确认',
      receivedAt,
    });

    expect(harness.conversation.calls).toBe(1);
    expect(harness.extractor.calls).toBe(1);
    expect(harness.extractor.lastInput?.combinedText).toContain(sourceText);
    expect(harness.extractor.lastInput?.combinedText)
      .toContain('预算最晚下周一确认');
    expect(harness.messenger.actions).toHaveLength(1);
  });

  it('uses the previous raw message when 写跟进呀 resolves clarification', async (): Promise<void> => {
    const harness: TestHarness = createHarness();
    const receivedAt: Date = new Date();
    const originalText: string =
      '今天跟进星河科技，客户要销售自动归档，下一步发送报价方案。';

    await harness.workflow.handleMessage({
      ...createMessage('tenant-a', 'om-clarification-source'),
      text: originalText,
      receivedAt,
    });
    await harness.workflow.handleMessage({
      ...createMessage('tenant-a', 'om-clarification-record'),
      text: '写跟进呀',
      receivedAt: new Date(receivedAt.getTime() + 1_000),
    });

    expect(harness.extractor.calls).toBe(1);
    expect(harness.extractor.lastInput?.currentText).toBe(originalText);
    expect(harness.extractor.lastInput?.combinedText).toBe(originalText);
    expect(harness.extractor.lastInput?.combinedText).not.toContain('写跟进呀');
    expect(harness.messenger.actions).toHaveLength(1);
    expect(harness.messenger.actions[0].payload.sourceMessageId)
      .toBe('om-clarification-source');
    expect(harness.messenger.actions[0].payload.taskCandidates?.[0])
      .toMatchObject({
        status: 'needs_input',
        missingFields: ['pastDueAt'],
      });
    expect(JSON.stringify(createConfirmationCard(
      harness.messenger.actions[0],
    ))).toContain('执行时间已过期，请修改');
    expect(harness.records.followupCalls).toBe(0);
    expect(harness.tasks.calls).toBe(0);
    expect(harness.store.getAudits(harness.integrationA.tenantId)
      .some((event): boolean =>
        event.eventType === 'message.intent_clarification_resolved.v1'))
      .toBe(true);
  });

  it('uses the previous raw message when 帮我写跟进 resolves clarification', async (): Promise<void> => {
    const harness: TestHarness = createHarness();
    const receivedAt: Date = new Date();
    const originalText: string =
      '今天跟进星河科技，客户需要销售自动归档，预计金额五万元。';

    await harness.workflow.handleMessage({
      ...createMessage('tenant-a', 'om-natural-source'),
      text: originalText,
      receivedAt,
    });
    await harness.workflow.handleMessage({
      ...createMessage('tenant-a', 'om-natural-record'),
      text: '帮我写跟进',
      receivedAt: new Date(receivedAt.getTime() + 1_000),
    });

    expect(harness.extractor.calls).toBe(1);
    expect(harness.extractor.lastInput?.currentText).toBe(originalText);
    expect(harness.extractor.lastInput?.combinedText).toBe(originalText);
    expect(harness.extractor.lastInput?.combinedText)
      .not.toContain('帮我写跟进');
    expect(harness.messenger.actions).toHaveLength(1);
  });

  it('passes trusted thread boundaries to the conversation runtime', async (): Promise<void> => {
    const harness: TestHarness = createHarness();
    const receivedAt: Date = new Date();
    const originalText: string = '客户担心数据权限隔离，暂未确认采购。';

    await harness.workflow.handleMessage({
      ...createMessage('tenant-a', 'om-memory-source'),
      text: originalText,
      receivedAt,
    });
    await harness.workflow.handleMessage({
      ...createMessage('tenant-a', 'om-memory-record'),
      text: '帮我写跟进',
      receivedAt: new Date(receivedAt.getTime() + 1_000),
    });

    expect(JSON.stringify(harness.conversation.inputs[1]))
      .toContain(originalText);
    expect(harness.conversation.inputs[1]?.context).toMatchObject({
      tenantId: harness.integrationA.tenantId,
      actorOpenId: 'ou_sales',
      chatId: 'oc_tenant-a',
      sourceMessageId: 'om-memory-record',
    });
  });

  it('analyzes the previous raw message and closes clarification without writes', async (): Promise<void> => {
    const harness: TestHarness = createHarness();
    const receivedAt: Date = new Date();
    const originalText: string = '客户担心数据权限隔离，暂未确认采购。';

    await harness.workflow.handleMessage({
      ...createMessage('tenant-a', 'om-clarification-analyze-source'),
      text: originalText,
      receivedAt,
    });
    harness.conversation.nextDecision = {
      schemaVersion: 'conversation-intent-v1',
      intent: 'sales_qa',
      confidence: 0.96,
      reply: '这会延长安全评审，应补充隔离方案与验证计划。',
    };
    await harness.workflow.handleMessage({
      ...createMessage('tenant-a', 'om-clarification-analyze'),
      text: '只分析一下，不记录',
      receivedAt: new Date(receivedAt.getTime() + 1_000),
    });

    expect(harness.conversation.calls).toBe(2);
    expect(JSON.stringify(harness.conversation.inputs[1])).toContain(originalText);
    expect(harness.messenger.texts.at(-1)).toContain('安全评审');
    expect(await harness.store.getOpenSession(
      harness.integrationA.tenantId,
      'ou_sales',
    )).toBeNull();
    expect(harness.extractor.calls).toBe(0);
    expect(harness.messenger.actions).toHaveLength(0);
    expect(harness.records.followupCalls).toBe(0);
    expect(harness.tasks.calls).toBe(0);
  });

  it('does not reuse clarification context across chats or users', async (): Promise<void> => {
    const harness: TestHarness = createHarness();
    const receivedAt: Date = new Date();
    await harness.workflow.handleMessage({
      ...createMessage('tenant-a', 'om-scoped-source'),
      text: '张总说预算下周批',
      receivedAt,
    });

    await harness.workflow.handleMessage({
      ...createMessage('tenant-a', 'om-other-chat'),
      chatId: 'oc_other_chat',
      text: '写跟进呀',
      receivedAt: new Date(receivedAt.getTime() + 1_000),
    });
    await harness.workflow.handleMessage({
      ...createMessage('tenant-a', 'om-other-user'),
      senderOpenId: 'ou_other',
      text: '写跟进呀',
      receivedAt: new Date(receivedAt.getTime() + 2_000),
    });
    await harness.workflow.handleMessage({
      ...createMessage('tenant-b', 'om-other-tenant'),
      chatId: 'oc_tenant-a',
      text: '写跟进呀',
      receivedAt: new Date(receivedAt.getTime() + 3_000),
    });

    expect(harness.extractor.calls).toBe(0);
    expect(harness.messenger.actions).toHaveLength(3);
    expect(harness.messenger.actions.every((action: PendingAction): boolean =>
      action.payload.interactionStage === 'input')).toBe(true);
  });

  it('closes clarification when the seller explicitly switches topic', async (): Promise<void> => {
    const harness: TestHarness = createHarness();
    const receivedAt: Date = new Date();
    await harness.workflow.handleMessage({
      ...createMessage('tenant-a', 'om-switch-source'),
      text: '张总说预算下周批',
      receivedAt,
    });
    harness.conversation.nextDecision = {
      schemaVersion: 'conversation-intent-v1',
      intent: 'general_chat',
      confidence: 0.98,
      reply: '你好，我可以回答销售问题，也可以在你确认后保存跟进。',
    };

    await harness.workflow.handleMessage({
      ...createMessage('tenant-a', 'om-switch-topic'),
      text: '你好，你能做什么？',
      receivedAt: new Date(receivedAt.getTime() + 1_000),
    });

    expect(await harness.store.getOpenSession(
      harness.integrationA.tenantId,
      'ou_sales',
    )).toBeNull();
    expect(harness.store.getAudits(harness.integrationA.tenantId)
      .some((event): boolean =>
        event.eventType === 'message.intent_clarification_resolved.v1' &&
        event.details.resolution === 'topic_switched')).toBe(true);
    expect(harness.extractor.calls).toBe(0);
  });

  it('does not reuse an expired intent-clarification session', async (): Promise<void> => {
    vi.useFakeTimers();
    try {
      const harness: TestHarness = createHarness();
      const receivedAt: Date = new Date('2026-09-21T10:00:00+08:00');
      vi.setSystemTime(receivedAt);
      await harness.workflow.handleMessage({
        ...createMessage('tenant-a', 'om-expiring-source'),
        text: '张总说预算下周批',
        receivedAt,
      });

      const afterExpiry: Date = new Date(
        receivedAt.getTime() + 31 * 60 * 1_000,
      );
      vi.setSystemTime(afterExpiry);
      await harness.workflow.handleMessage({
        ...createMessage('tenant-a', 'om-after-expiry'),
        text: '写跟进呀',
        receivedAt: afterExpiry,
      });

      expect(harness.extractor.calls).toBe(0);
      expect(harness.messenger.actions).toHaveLength(1);
      expect(harness.messenger.actions[0].payload.interactionStage)
        .toBe('input');
    } finally {
      vi.useRealTimers();
    }
  });

  it('trusts the LLM followup intent instead of a keyword gate', async (): Promise<void> => {
    const harness: TestHarness = createHarness();
    harness.conversation.nextDecision = {
      schemaVersion: 'conversation-intent-v1',
      intent: 'followup_capture',
      confidence: 0.99,
      reply: '已经记录。',
    };

    await harness.workflow.handleMessage({
      ...createMessage(),
      text: '张总说预算下周批',
    });

    expect(harness.extractor.calls).toBe(0);
    expect(harness.messenger.actions).toHaveLength(1);
    expect(harness.messenger.actions[0].payload.interactionStage)
      .toBe('input');
    expect(harness.messenger.texts.at(-1)).not.toContain('不会直接写入');
    expect(harness.records.followupCalls).toBe(0);
    expect(harness.tasks.calls).toBe(0);
  });

  it.each(['把刚才内容整理成跟进', '那就记录下来', '帮我写一下'])
    ('routes natural followup request %s through the model', async (text: string): Promise<void> => {
      const harness: TestHarness = createHarness();
      harness.conversation.nextDecision = {
        schemaVersion: 'conversation-intent-v1',
        intent: 'followup_capture',
        confidence: 0.94,
        reply: '我会整理成待确认的跟进草案。',
      };

      await harness.workflow.handleMessage({
        ...createMessage('tenant-a', `om-natural-${text}`),
        text,
      });

      expect(harness.conversation.calls).toBe(1);
      expect(harness.messenger.actions).toHaveLength(1);
      expect(harness.messenger.actions[0].payload.interactionStage)
        .toBe('input');
      expect(harness.extractor.calls).toBe(0);
    });

  it('enters the existing followup flow for an explicit inline record command', async (): Promise<void> => {
    const harness: TestHarness = createHarness();

    await harness.workflow.handleMessage(createMessage());

    expect(harness.extractor.calls).toBe(1);
    expect(harness.messenger.actions).toHaveLength(1);
  });

  it('opens an owned Card 2.0 intake form after AI classifies 写跟进', async (): Promise<void> => {
    const harness: TestHarness = createHarness();
    const command: IncomingMessage = {
      ...createMessage(),
      text: '写跟进',
      receivedAt: new Date('2026-09-20T10:00:00+08:00'),
    };

    await harness.workflow.handleMessage(command);

    expect(harness.extractor.lastInput).toBeNull();
    expect(harness.conversation.calls).toBe(1);
    expect(harness.messenger.actions).toHaveLength(1);
    const intake: PendingAction = harness.messenger.actions[0];
    expect(intake.payload.interactionStage).toBe('input');
    expect(intake.payload.draftVersion).toBe(0);
    expect(JSON.stringify(createConfirmationCard(intake)))
      .toContain('沟通原文');
    expect(JSON.stringify(createConfirmationCard(intake)))
      .toContain('生成草案并检查');
    expect(harness.records.customerCalls).toBe(0);
    expect(harness.tasks.calls).toBe(0);
  });

  it('does not let a keyword bypass an AI non-followup decision', async (): Promise<void> => {
    const harness: TestHarness = createHarness();
    harness.conversation.nextDecision = {
      schemaVersion: 'conversation-intent-v1',
      intent: 'general_chat',
      confidence: 0.98,
      reply: '我可以和你聊销售方法、整理跟进或生成内容。',
    };

    await harness.workflow.handleMessage({
      ...createMessage(),
      text: '写跟进',
    });

    expect(harness.conversation.calls).toBe(1);
    expect(harness.messenger.actions).toHaveLength(0);
    expect(harness.messenger.texts.at(-1)).toBe(
      '我可以和你聊销售方法、整理跟进或生成内容。',
    );
    expect(harness.extractor.calls).toBe(0);
    expect(harness.records.customerCalls).toBe(0);
    expect(harness.tasks.calls).toBe(0);
  });

  it('turns the owned intake form into v1 review without business writes', async (): Promise<void> => {
    const harness: TestHarness = createHarness();
    await harness.workflow.handleMessage({
      ...createMessage(),
      text: '写跟进',
      receivedAt: new Date('2026-09-20T10:00:00+08:00'),
    });

    const processingCard: JsonObject = await harness.workflow.handleCardAction(
      createIntakeFormAction(),
    );

    expect(JSON.stringify(processingCard)).toContain('正在生成跟进草案');
    await waitForUpdates(harness.messenger, 1);

    expect(harness.extractor.lastInput?.currentText)
      .toContain('张总认可试点方案');
    expect(harness.extractor.lastInput?.combinedText)
      .toContain('客户：北辰制造');
    const saved: PendingAction | null = await harness.store.getPendingAction(
      harness.integrationA.tenantId,
      harness.messenger.actions[0].id,
    );
    expect(saved?.payload.interactionStage).toBe('draft');
    expect(saved?.payload.draftVersion).toBe(1);
    expect(JSON.stringify(harness.messenger.updates[0]))
      .toContain('销售跟进草案');
    expect(JSON.stringify(harness.messenger.updates[0])).toContain('v1');
    expect(harness.records.customerCalls).toBe(0);
    expect(harness.tasks.calls).toBe(0);
  });

  it('rejects a different operator submitting the intake form', async (): Promise<void> => {
    const harness: TestHarness = createHarness();
    await harness.workflow.handleMessage({
      ...createMessage(),
      text: '写跟进',
      receivedAt: new Date('2026-09-20T10:00:00+08:00'),
    });

    const response: JsonObject = await harness.workflow.handleCardAction(
      createIntakeFormAction('evt-intake-other-user', {
        operatorOpenId: 'ou_other',
      }),
    );

    expect(JSON.stringify(response)).toContain('不属于当前用户或租户');
    expect(harness.extractor.lastInput).toBeNull();
    expect(harness.records.followupCalls).toBe(0);
    expect(harness.tasks.calls).toBe(0);
  });

  it('rejects blank communication content without model or writes', async (): Promise<void> => {
    const harness: TestHarness = createHarness();
    await harness.workflow.handleMessage({
      ...createMessage(),
      text: '写跟进',
      receivedAt: new Date('2026-09-20T10:00:00+08:00'),
    });
    const blankForm: IncomingCardAction = createIntakeFormAction();
    blankForm.formValue.communicationContent = '   ';

    const response: JsonObject = await harness.workflow.handleCardAction(
      blankForm,
    );

    expect(JSON.stringify(response)).toContain('沟通原文不能为空');
    expect(harness.extractor.lastInput).toBeNull();
    expect(harness.records.followupCalls).toBe(0);
    expect(harness.tasks.calls).toBe(0);
  });

  it('does not regenerate after the intake form has become a draft', async (): Promise<void> => {
    const harness: TestHarness = createHarness();
    await harness.workflow.handleMessage({
      ...createMessage(),
      text: '写跟进',
      receivedAt: new Date('2026-09-20T10:00:00+08:00'),
    });
    await harness.workflow.handleCardAction(
      createIntakeFormAction('evt-intake-first'),
    );
    await waitForUpdates(harness.messenger, 1);
    harness.extractor.lastInput = null;

    const response: JsonObject = await harness.workflow.handleCardAction(
      createIntakeFormAction('evt-intake-duplicate'),
    );

    expect(JSON.stringify(response)).toContain('不属于当前用户或租户');
    expect(harness.extractor.lastInput).toBeNull();
    expect(harness.records.followupCalls).toBe(0);
    expect(harness.tasks.calls).toBe(0);
  });

  it('restores a prefilled retryable form when generation fails', async (): Promise<void> => {
    const harness: TestHarness = createHarness();
    harness.extractor.failNext = true;
    await harness.workflow.handleMessage({
      ...createMessage(),
      text: '写跟进',
      receivedAt: new Date('2026-09-20T10:00:00+08:00'),
    });

    const processing: JsonObject = await harness.workflow.handleCardAction(
      createIntakeFormAction('evt-intake-failure'),
    );
    expect(JSON.stringify(processing)).toContain('正在生成跟进草案');
    await waitForUpdates(harness.messenger, 1);

    const saved: PendingAction | null = await harness.store.getPendingAction(
      harness.integrationA.tenantId,
      harness.messenger.actions[0].id,
    );
    expect(saved?.payload.interactionStage).toBe('input');
    expect(saved?.payload.inputForm?.communicationContent)
      .toContain('张总认可试点方案');
    expect(JSON.stringify(harness.messenger.updates[0]))
      .toContain('暂时无法生成草案');
    expect(harness.extractor.calls).toBe(1);
    expect(harness.records.followupCalls).toBe(0);
    expect(harness.tasks.calls).toBe(0);
  });

  it('does not call write tools before confirmation', async (): Promise<void> => {
    const harness: TestHarness = createHarness();

    await harness.workflow.handleMessage(createMessage());

    expect(harness.messenger.actions).toHaveLength(1);
    expect(harness.records.customerCalls).toBe(0);
    expect(harness.records.opportunityCalls).toBe(0);
    expect(harness.records.followupCalls).toBe(0);
    expect(harness.tasks.calls).toBe(0);
  });

  it('renders ISO due times in the Shanghai wall-clock timezone', async (): Promise<void> => {
    const harness: TestHarness = createHarness();

    await harness.workflow.handleMessage(createMessage());

    const pending: PendingAction = harness.messenger.actions[0];
    const card: string = JSON.stringify(createConfirmationCard(pending));
    expect(pending.payload.draft.dueAt)
      .toBe('2026-09-20T02:00:00.000Z');
    expect(card).toContain('"initial_datetime":"2026-09-20 10:00"');
    expect(card).not.toContain('"initial_datetime":"2026-09-20 02:00"');
  });

  it('creates an editable card when required fields are missing', async (): Promise<void> => {
    const incompleteDraft: FollowupDraft = {
      ...completeDraft,
      customerName: null,
      nextAction: null,
      dueAt: null,
    };
    const harness: TestHarness = createHarness(incompleteDraft);

    await harness.workflow.handleMessage(createMessage());

    expect(harness.messenger.actions).toHaveLength(1);
    const card: string = JSON.stringify(createConfirmationCard(
      harness.messenger.actions[0],
    ));
    expect(card).toContain('客户');
    expect(card).toContain('下一步计划');
    expect(card).toContain('执行时间');
    expect(harness.records.customerCalls).toBe(0);
    expect(harness.tasks.calls).toBe(0);
  });

  it('deduplicates the same tenant message ID', async (): Promise<void> => {
    const harness: TestHarness = createHarness();
    const message: IncomingMessage = createMessage();

    await harness.workflow.handleMessage(message);
    await harness.workflow.handleMessage(message);

    expect(harness.messenger.actions).toHaveLength(1);
  });

  it('cancels with zero external side effects', async (): Promise<void> => {
    const harness: TestHarness = createHarness();
    await harness.workflow.handleMessage(createMessage());
    const pending: PendingAction = harness.messenger.actions[0];

    const response: JsonObject = await harness.workflow.handleCardAction(
      createCardAction('tenant-a', pending.id, 'cancel', 'evt-cancel'),
    );

    const saved: PendingAction | null =
      await harness.store.getPendingAction(
        harness.integrationA.tenantId,
        pending.id,
      );
    expect(saved?.status).toBe('cancelled');
    expect(JSON.stringify(response)).toContain('已取消销售动作');
    expect(harness.messenger.updates).toHaveLength(0);
    await waitForUpdates(harness.messenger, 1);
    expect(harness.messenger.updateMessageIds).toEqual(['om_card_1']);
    expect(harness.messenger.updates).toHaveLength(1);
    const cancelledCard: string = JSON.stringify(
      harness.messenger.updates[0],
    );
    expect(cancelledCard).toContain('已取消销售动作');
    expect(cancelledCard).not.toContain('确认保存');
    expect(harness.store.getAudits(harness.integrationA.tenantId))
      .toEqual(expect.arrayContaining([
        expect.objectContaining({
          eventType: 'card.cancel_patch_succeeded',
          outcome: 'succeeded',
        }),
      ]));
    expect(harness.records.customerCalls).toBe(0);
    expect(harness.tasks.calls).toBe(0);
  });

  it('repairs a restored cancelled card when cancel is clicked again', async (): Promise<void> => {
    const harness: TestHarness = createHarness();
    await harness.workflow.handleMessage(createMessage());
    const pending: PendingAction = harness.messenger.actions[0];

    await harness.workflow.handleCardAction(
      createCardAction('tenant-a', pending.id, 'cancel', 'evt-cancel-first'),
    );
    await waitForUpdates(harness.messenger, 1);
    harness.messenger.updates.length = 0;
    harness.messenger.updateMessageIds.length = 0;

    const response: JsonObject = await harness.workflow.handleCardAction(
      createCardAction('tenant-a', pending.id, 'cancel', 'evt-cancel-heal'),
    );

    expect(JSON.stringify(response)).toContain('已取消销售动作');
    expect(harness.messenger.updates).toHaveLength(0);
    await waitForUpdates(harness.messenger, 1);
    expect(harness.messenger.updateMessageIds).toEqual(['om_card_1']);
    expect(JSON.stringify(harness.messenger.updates[0]))
      .toContain('已取消销售动作');
    expect(harness.records.customerCalls).toBe(0);
    expect(harness.tasks.calls).toBe(0);
  });

  it('keeps cancellation final and audits a persistent card patch failure', async (): Promise<void> => {
    const harness: TestHarness = createHarness();
    await harness.workflow.handleMessage(createMessage());
    const pending: PendingAction = harness.messenger.actions[0];
    harness.messenger.failNextUpdate = true;

    const response: JsonObject = await harness.workflow.handleCardAction(
      createCardAction(
        'tenant-a',
        pending.id,
        'cancel',
        'evt-cancel-patch-failure',
      ),
    );

    const saved: PendingAction | null = await harness.store.getPendingAction(
      harness.integrationA.tenantId,
      pending.id,
    );
    expect(saved?.status).toBe('cancelled');
    expect(JSON.stringify(response)).toContain('已取消销售动作');
    expect(harness.store.getAudits(harness.integrationA.tenantId))
      .not.toEqual(expect.arrayContaining([
        expect.objectContaining({
          eventType: 'card.cancel_patch_failed',
        }),
      ]));
    await waitForAudit(
      harness.store,
      harness.integrationA.tenantId,
      'card.cancel_patch_failed',
    );
    expect(harness.store.getAudits(harness.integrationA.tenantId))
      .toEqual(expect.arrayContaining([
        expect.objectContaining({
          eventType: 'card.cancel_patch_failed',
          outcome: 'failed',
        }),
      ]));
    expect(harness.records.customerCalls).toBe(0);
    expect(harness.tasks.calls).toBe(0);
  });

  it('executes duplicate confirmation only once', async (): Promise<void> => {
    const harness: TestHarness = createHarness();
    await harness.workflow.handleMessage(createMessage());
    const pending: PendingAction = harness.messenger.actions[0];

    await Promise.all([
      harness.workflow.handleCardAction(
        createCardAction('tenant-a', pending.id, 'confirm', 'evt-confirm-1'),
      ),
      harness.workflow.handleCardAction(
        createCardAction('tenant-a', pending.id, 'confirm', 'evt-confirm-2'),
      ),
    ]);
    await waitForStatus(
      harness.store,
      harness.integrationA.tenantId,
      pending.id,
      'succeeded',
    );

    expect(harness.records.customerCalls).toBe(1);
    expect(harness.records.opportunityCalls).toBe(1);
    expect(harness.records.followupCalls).toBe(1);
    expect(harness.tasks.calls).toBe(1);
  });

  it('reviews edited card fields without executing them', async (): Promise<void> => {
    const harness: TestHarness = createHarness();
    await harness.workflow.handleMessage(createMessage());
    const original: PendingAction = harness.messenger.actions[0];

    const reviewedCard: JsonObject = await harness.workflow.handleCardAction(
      createDraftFormAction(original, 1, 'evt-edited-confirm', {
        nextAction: '安排现场技术交流',
        nextActionChannel: '客户现场',
        nextActionParticipants: '张总、售前王工',
      }, 'review'),
    );

    expect(JSON.stringify(reviewedCard)).toContain('v2');
    expect(harness.messenger.updates).toHaveLength(1);
    expect(JSON.stringify(harness.messenger.updates[0])).toContain('v2');
    expect(harness.records.followupCalls).toBe(0);
    expect(harness.tasks.calls).toBe(0);
    const versionTwo: PendingAction | null =
      await harness.store.getPendingAction(
        harness.integrationA.tenantId,
        original.id,
      );
    expect(versionTwo?.payload.draftVersion).toBe(2);
    expect(versionTwo?.payload.draft.nextAction).toBe('安排现场技术交流');
    expect(versionTwo?.status).toBe('pendingConfirmation');
  });

  it('executes edited card fields with one confirmation and returns a record link', async (): Promise<void> => {
    const harness: TestHarness = createHarness();
    await harness.workflow.handleMessage(createMessage());
    const original: PendingAction = harness.messenger.actions[0];

    const processing: JsonObject = await harness.workflow.handleCardAction(
      createDraftFormAction(original, 1, 'evt-edited-confirm-once', {
        nextAction: '安排现场技术交流',
        nextActionChannel: '客户现场',
        nextActionParticipants: '张总、售前王工',
      }),
    );

    expect(JSON.stringify(processing)).toContain('正在执行销售动作');
    await waitForStatus(
      harness.store,
      harness.integrationA.tenantId,
      original.id,
      'succeeded',
    );
    expect(harness.records.followupCalls).toBe(1);
    expect(harness.tasks.calls).toBe(1);
    await waitForUpdates(harness.messenger, 2);
    expect(harness.messenger.results).toHaveLength(0);
    expect(JSON.stringify(harness.messenger.updates[1]))
      .toContain('https://base.example/followups/rec_followup');
  });

  it('opens a terminal result as one editable revision and updates original records', async (): Promise<void> => {
    const harness: TestHarness = createHarness();
    await harness.workflow.handleMessage(createMessage());
    const original: PendingAction = harness.messenger.actions[0];
    await harness.workflow.handleCardAction(
      createCardAction('tenant-a', original.id, 'confirm', 'evt-edit-seed'),
    );
    await waitForStatus(
      harness.store,
      harness.integrationA.tenantId,
      original.id,
      'succeeded',
    );

    const completed: PendingAction | null =
      await harness.store.getPendingAction(
        harness.integrationA.tenantId,
        original.id,
      );
    if (completed === null || completed.cardMessageId === null) {
      throw new Error('Expected completed action with card message');
    }
    const editCard: JsonObject = await harness.workflow.handleCardAction(
      createCardAction(
        'tenant-a',
        original.id,
        'edit',
        'evt-edit-open',
        new Date('2026-09-17T10:03:00+08:00'),
        completed.cardMessageId,
      ),
    );
    expect(JSON.stringify(editCard)).toContain('确认保存');
    expect(JSON.stringify(editCard)).not.toContain('跟进登记成功');

    const revision: PendingAction | null =
      await harness.store.getPendingActionByCardMessage(
        harness.integrationA.tenantId,
        completed.cardMessageId,
      );
    if (revision === null) throw new Error('Expected revision action');
    expect(revision.id).not.toBe(original.id);
    expect(revision.payload.operationKind).toBe('update');
    expect(revision.payload.revisionOfActionId).toBe(original.id);
    expect(revision.payload.executionTarget?.followupRecordId)
      .toBe('rec_followup');

    await harness.workflow.handleCardAction(
      createDraftFormAction(revision, 1, 'evt-edit-confirm', {
        generatedBody: '更新后的跟进正文',
      }),
    );
    await waitForStatus(
      harness.store,
      harness.integrationA.tenantId,
      revision.id,
      'succeeded',
    );
    expect(harness.records.followupCalls).toBe(1);
    expect(harness.records.followupUpdateCalls).toBe(1);
    expect(harness.tasks.calls).toBe(1);
    expect(harness.tasks.updateCalls).toBe(1);
  });

  it('refreshes a stale draft card to the latest saved version', async (): Promise<void> => {
    const harness: TestHarness = createHarness();
    await harness.workflow.handleMessage(createMessage());
    const original: PendingAction = harness.messenger.actions[0];

    await harness.workflow.handleCardAction(
      createDraftFormAction(original, 1, 'evt-create-v2', {
        nextAction: '安排现场技术交流',
      }, 'review'),
    );
    const versionTwo: PendingAction | null =
      await harness.store.getPendingAction(
        harness.integrationA.tenantId,
        original.id,
      );
    if (versionTwo === null) {
      throw new Error('Reviewed action was not persisted');
    }

    const refreshed: JsonObject = await harness.workflow.handleCardAction(
      createDraftFormAction(original, 1, 'evt-refresh-stale-v1'),
    );

    expect(JSON.stringify(refreshed)).toContain('v2');
    expect(harness.messenger.updates).toHaveLength(2);
    expect(JSON.stringify(harness.messenger.updates[1])).toContain('v2');
    const unchanged: PendingAction | null =
      await harness.store.getPendingAction(
        harness.integrationA.tenantId,
        original.id,
      );
    expect(unchanged?.payload.draftVersion).toBe(2);
    expect(unchanged?.payload.draft.nextAction)
      .toBe(versionTwo.payload.draft.nextAction);
    expect(harness.records.followupCalls).toBe(0);
    expect(harness.tasks.calls).toBe(0);
  });

  it('updates the confirmed draft card to processing before execution', async (): Promise<void> => {
    const harness: TestHarness = createHarness();
    await harness.workflow.handleMessage(createMessage());
    const pending: PendingAction = harness.messenger.actions[0];
    await harness.workflow.handleCardAction(
      createDraftFormAction(pending, 1, 'evt-processing-create-v2', {
        nextAction: '安排现场技术交流',
        nextActionChannel: '客户现场',
        nextActionParticipants: '张总、售前王工',
      }, 'review'),
    );
    const versionTwo: PendingAction | null =
      await harness.store.getPendingAction(
        harness.integrationA.tenantId,
        pending.id,
      );
    if (versionTwo === null) {
      throw new Error('Reviewed action was not persisted');
    }
    harness.messenger.updates.length = 0;

    const processing: JsonObject = await harness.workflow.handleCardAction(
      createDraftFormAction(versionTwo, 2, 'evt-processing-card'),
    );

    expect(JSON.stringify(processing)).toContain('正在执行销售动作');
    expect(harness.messenger.updates).toHaveLength(0);
    await waitForStatus(
      harness.store,
      harness.integrationA.tenantId,
      pending.id,
      'succeeded',
    );
    await waitForUpdates(harness.messenger, 2);
    expect(JSON.stringify(harness.messenger.updates[0]))
      .toContain('正在执行销售动作');
    expect(JSON.stringify(harness.messenger.updates[1]))
      .toContain('跟进登记成功');
    expect(JSON.stringify(harness.messenger.updates[1]))
      .toContain('查看跟进记录');
    expect(JSON.stringify(harness.messenger.updates[1]))
      .not.toContain('确认保存并创建所示待办');
    expect(harness.records.followupCalls).toBe(1);
    expect(harness.tasks.calls).toBe(1);
  });

  it('retries only the unfinished steps after partial failure', async (): Promise<void> => {
    const harness: TestHarness = createHarness();
    harness.records.failNextFollowup = true;
    await harness.workflow.handleMessage(createMessage());
    const pending: PendingAction = harness.messenger.actions[0];

    await harness.workflow.handleCardAction(
      createCardAction('tenant-a', pending.id, 'confirm', 'evt-partial'),
    );
    await waitForStatus(
      harness.store,
      harness.integrationA.tenantId,
      pending.id,
      'partialFailure',
    );
    await harness.workflow.handleCardAction(
      createCardAction('tenant-a', pending.id, 'retry', 'evt-retry'),
    );
    await waitForStatus(
      harness.store,
      harness.integrationA.tenantId,
      pending.id,
      'succeeded',
    );

    expect(harness.records.customerCalls).toBe(1);
    expect(harness.records.opportunityCalls).toBe(1);
    expect(harness.records.followupCalls).toBe(2);
    expect(harness.tasks.calls).toBe(1);
  });

  it('keeps a zero-progress failure retryable', async (): Promise<void> => {
    const harness: TestHarness = createHarness();
    harness.records.failNextCustomer = true;
    await harness.workflow.handleMessage(createMessage());
    const pending: PendingAction = harness.messenger.actions[0];

    await harness.workflow.handleCardAction(
      createCardAction('tenant-a', pending.id, 'confirm', 'evt-failed'),
    );
    await waitForStatus(
      harness.store,
      harness.integrationA.tenantId,
      pending.id,
      'failed',
    );
    await harness.workflow.handleCardAction(
      createCardAction('tenant-a', pending.id, 'retry', 'evt-failed-retry'),
    );
    await waitForStatus(
      harness.store,
      harness.integrationA.tenantId,
      pending.id,
      'succeeded',
    );

    expect(harness.records.customerCalls).toBe(2);
    expect(harness.records.opportunityCalls).toBe(1);
    expect(harness.records.followupCalls).toBe(1);
    expect(harness.tasks.calls).toBe(1);
  });

  it('expires stale confirmations without external writes', async (): Promise<void> => {
    const harness: TestHarness = createHarness();
    await harness.workflow.handleMessage(createMessage());
    const pending: PendingAction = harness.messenger.actions[0];

    await harness.workflow.handleCardAction(
      createCardAction(
        'tenant-a',
        pending.id,
        'confirm',
        'evt-expired',
        new Date('2026-09-18T10:00:00+08:00'),
      ),
    );

    const expired: PendingAction | null =
      await harness.store.getPendingAction(
        harness.integrationA.tenantId,
        pending.id,
      );
    expect(expired?.status).toBe('expired');
    expect(harness.records.customerCalls).toBe(0);
    expect(harness.records.opportunityCalls).toBe(0);
    expect(harness.records.followupCalls).toBe(0);
    expect(harness.tasks.calls).toBe(0);
    expect(
      harness.store
        .getAudits(harness.integrationA.tenantId)
        .some(
          (event): boolean =>
            event.eventType === 'card.already_handled' &&
            event.details.currentStatus === 'expired',
        ),
    ).toBe(true);
  });

  it('isolates message claims and actions by tenant', async (): Promise<void> => {
    const harness: TestHarness = createHarness();
    expect(
      await harness.store.claimMessage(
        harness.integrationA.tenantId,
        'same-message',
      ),
    ).toBe(true);
    expect(
      await harness.store.claimMessage(
        harness.integrationB.tenantId,
        'same-message',
      ),
    ).toBe(true);

    await harness.workflow.handleMessage(
      createMessage('tenant-a', 'om_tenant_action'),
    );
    const pending: PendingAction = harness.messenger.actions[0];
    await harness.workflow.handleCardAction(
      createCardAction('tenant-b', pending.id, 'confirm', 'evt-cross'),
    );

    expect(
      await harness.store.getPendingAction(
        harness.integrationB.tenantId,
        pending.id,
      ),
    ).toBeNull();
    expect(harness.records.customerCalls).toBe(0);
    expect(harness.tasks.calls).toBe(0);
  });
});
