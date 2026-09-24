import { MemorySaver } from '@langchain/langgraph';
import { describe, expect, it, vi } from 'vitest';

import type {
  ConversationDecision,
  ConversationInput,
} from '@server/modules/agent-core/agent.types';
import type {
  ConversationIntentModel,
} from '@server/modules/llm/langchain-intent.model';
import type {
  LangGraphCheckpointPort,
} from '@server/modules/llm/langgraph-checkpointer.service';
import type {
  LongTermMemoryItem,
  LongTermMemoryPort,
} from '@server/modules/llm/long-term-memory.port';
import { LangGraphConversationAssistant } from '@server/modules/llm/langgraph-conversation.assistant';

class StubIntentModel implements ConversationIntentModel {
  readonly prompts: string[] = [];

  async invoke(prompt: string): Promise<ConversationDecision> {
    this.prompts.push(prompt);
    return {
      schemaVersion: 'conversation-intent-v1',
      intent: 'general_chat',
      confidence: 0.98,
      reply: '你好，我可以帮你整理销售跟进。',
    };
  }
}

class TestCheckpointer implements LangGraphCheckpointPort {
  readonly saver: MemorySaver = new MemorySaver();

  readyCalls: number = 0;

  getSaver(): MemorySaver {
    return this.saver;
  }

  async ensureReady(): Promise<void> {
    this.readyCalls += 1;
  }
}

class TestLongTermMemory implements LongTermMemoryPort {
  readonly searchedScopes: Array<{ tenantId: string; actorOpenId: string }> = [];

  isEnabled(): boolean { return true; }
  async addApprovedMemory(): Promise<{ status: 'written'; memoryIds: string[] }> {
    return { status: 'written', memoryIds: ['memory-1'] };
  }
  async search(
    scope: { tenantId: string; actorOpenId: string },
    _query: string,
  ): Promise<LongTermMemoryItem[]> {
    this.searchedScopes.push(scope);
    return [{
      memoryId: 'memory-1',
      text: '偏好用三段式总结跟进。',
      metadata: { category: 'sales_workflow_preference' },
      score: 0.9,
    }];
  }
  async delete(): Promise<boolean> { return false; }
  async history(): Promise<[]> { return []; }
  async health(): Promise<{ enabled: boolean; ready: boolean }> {
    return { enabled: true, ready: true };
  }
}

const createInput = (
  context: ConversationInput['context'],
  text: string = '你好',
): ConversationInput => ({
  text,
  timezone: 'Asia/Shanghai',
  now: new Date('2026-09-23T10:00:00+08:00'),
  context,
});

describe('LangGraphConversationAssistant', (): void => {
  it('rejects missing tenant, actor, or chat boundaries', async (): Promise<void> => {
    const model: StubIntentModel = new StubIntentModel();
    const checkpointer: TestCheckpointer = new TestCheckpointer();
    const assistant: LangGraphConversationAssistant =
      new LangGraphConversationAssistant(model, checkpointer);

    await expect(
      assistant.respond(createInput({})),
    ).rejects.toThrow('tenant, actor, and chat');
    expect(model.prompts).toHaveLength(0);
  });

  it('runs the intent node with the tenant-scoped thread and persists checkpoints', async (): Promise<void> => {
    const model: StubIntentModel = new StubIntentModel();
    const checkpointer: TestCheckpointer = new TestCheckpointer();
    const assistant: LangGraphConversationAssistant =
      new LangGraphConversationAssistant(model, checkpointer);
    const context: ConversationInput['context'] = {
      tenantId: 'tenant-a',
      actorOpenId: 'ou-sales-a',
      chatId: 'oc-chat-a',
    };

    const decision: ConversationDecision = await assistant.respond(
      createInput(context),
    );

    expect(decision.intent).toBe('general_chat');
    expect(checkpointer.readyCalls).toBe(1);
    expect(model.prompts).toHaveLength(1);
    expect(model.prompts[0]).toContain('tenant-a');
    expect(model.prompts[0]).toContain('general_chat');
    expect(model.prompts[0])
      .toContain('问候、能力介绍和闲聊必须使用 general_chat');
    expect(model.prompts[0])
      .toContain('客户说预算下周批 -> ambiguous');
    expect(model.prompts[0])
      .toContain('怎样追问客户预算 -> sales_qa');

    const checkpoint = await checkpointer.saver.getTuple({
      configurable: {
        thread_id: 'tenant-a:ou-sales-a:oc-chat-a',
      },
    });
    expect(checkpoint).toBeDefined();
  });

  it('adds ACL-scoped Mem0 preferences to the intent prompt', async (): Promise<void> => {
    const model: StubIntentModel = new StubIntentModel();
    const checkpointer: TestCheckpointer = new TestCheckpointer();
    const memory: TestLongTermMemory = new TestLongTermMemory();
    const assistant: LangGraphConversationAssistant =
      new LangGraphConversationAssistant(model, checkpointer, memory);
    await assistant.respond(createInput({
      tenantId: 'tenant-a',
      actorOpenId: 'ou-sales-a',
      chatId: 'oc-chat-a',
    }, '帮我写跟进'));

    expect(memory.searchedScopes).toEqual([{
      tenantId: 'tenant-a',
      actorOpenId: 'ou-sales-a',
    }]);
    expect(model.prompts[0]).toContain('偏好用三段式总结跟进');
  });

  it('restores recent turns only inside the same tenant actor and chat thread', async (): Promise<void> => {
    const model: StubIntentModel = new StubIntentModel();
    const checkpointer: TestCheckpointer = new TestCheckpointer();
    const assistant: LangGraphConversationAssistant =
      new LangGraphConversationAssistant(model, checkpointer);
    const contextA: ConversationInput['context'] = {
      tenantId: 'tenant-a',
      actorOpenId: 'ou-sales-a',
      chatId: 'oc-chat-a',
      sourceMessageId: 'om-a-1',
    };

    await assistant.respond(createInput(contextA, '客户预算下周批'));
    await assistant.respond(createInput({
      ...contextA,
      sourceMessageId: 'om-a-2',
    }, '那就写成跟进'));
    await assistant.respond(createInput({
      ...contextA,
      tenantId: 'tenant-b',
      sourceMessageId: 'om-b-1',
    }, '你好'));

    expect(model.prompts[1]).toContain('客户预算下周批');
    expect(model.prompts[1]).toContain('你好，我可以帮你整理销售跟进。');
    expect(model.prompts[2]).not.toContain('客户预算下周批');
  });

  it('keeps recent turns inside the configured 24-hour thread window', async (): Promise<void> => {
    const model = new StubIntentModel();
    const checkpointer = new TestCheckpointer();
    const assistant = new LangGraphConversationAssistant(model, checkpointer);
    const context: ConversationInput['context'] = {
      tenantId: 'tenant-a',
      actorOpenId: 'ou-sales-a',
      chatId: 'oc-chat-a',
    };
    const startedAt = new Date('2026-09-23T10:00:00+08:00');

    await assistant.respond({
      ...createInput(context, '第一轮独有上下文'),
      now: startedAt,
    });
    await assistant.respond({
      ...createInput(context, '第二轮问题'),
      now: new Date(startedAt.getTime() + 23 * 60 * 60 * 1_000),
    });

    expect(model.prompts[1]).toContain('第一轮独有上下文');
  });

  it('deletes an expired thread before routing the next message', async (): Promise<void> => {
    const model = new StubIntentModel();
    const checkpointer = new TestCheckpointer();
    const deleteThread = vi.spyOn(checkpointer.saver, 'deleteThread');
    const assistant = new LangGraphConversationAssistant(model, checkpointer);
    const context: ConversationInput['context'] = {
      tenantId: 'tenant-a',
      actorOpenId: 'ou-sales-a',
      chatId: 'oc-chat-a',
    };
    const startedAt = new Date('2026-09-23T10:00:00+08:00');

    await assistant.respond({
      ...createInput(context, '不应跨天保留的上下文'),
      now: startedAt,
    });
    await assistant.respond({
      ...createInput(context, '过期后的新问题'),
      now: new Date(startedAt.getTime() + 25 * 60 * 60 * 1_000),
    });

    expect(deleteThread).toHaveBeenCalledWith(
      'tenant-a:ou-sales-a:oc-chat-a',
    );
    expect(model.prompts[1]).not.toContain('不应跨天保留的上下文');
  });
});
