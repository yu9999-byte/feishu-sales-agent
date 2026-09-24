import { describe, expect, it } from 'vitest';

import type {
  AddMemoryOptions,
  MemoryItem,
  Message,
  SearchMemoryOptions,
} from 'mem0ai/oss';
import type { AgentRuntimeConfig } from '@server/config/agent.config';
import {
  Mem0MemoryAdapter,
  type Mem0MemoryFactory,
} from '@server/modules/llm/mem0-memory.adapter';
import type {
  ApprovedLongTermMemoryInput,
  LongTermMemoryScope,
} from '@server/modules/llm/long-term-memory.port';

const runtimeConfig: AgentRuntimeConfig = {
  host: '127.0.0.1',
  port: 3100,
  databaseUrl: 'postgres://unused',
  llm: {
    baseUrl: 'https://llm.example.test/v1',
    apiKey: 'test-key',
    model: 'test-model',
  },
  feishu: {
    verificationToken: 'test-token',
    encryptKey: undefined,
  },
  longTermMemory: {
    enabled: false,
    vectorStoreProvider: 'qdrant',
    vectorStoreUrl: undefined,
    vectorStoreCollection: 'test-memory',
    vectorStoreDimension: undefined,
    embedderProvider: 'openai',
    embedderApiKey: undefined,
    embedderModel: undefined,
    embedderBaseUrl: undefined,
    embedderDimension: undefined,
    llmProvider: 'openai',
    llmApiKey: undefined,
    llmModel: undefined,
    llmBaseUrl: undefined,
    historyDbPath: undefined,
  },
};

const scope: LongTermMemoryScope = {
  tenantId: 'tenant-a',
  actorOpenId: 'ou-sales-a',
};

const approvedMemory: ApprovedLongTermMemoryInput = {
  text: '销售偏好用三段式总结跟进。',
  category: 'sales_workflow_preference',
  sourceRef: 'followup:confirmed:001',
  policyVersion: 'memory-policy-v1',
  approved: true,
  approvedBy: 'ou-sales-a',
};

const enabledConfig: AgentRuntimeConfig = {
  ...runtimeConfig,
  longTermMemory: {
    ...runtimeConfig.longTermMemory,
    enabled: true,
    vectorStoreUrl: 'http://qdrant.test',
    embedderApiKey: 'embedder-key',
    embedderModel: 'embedding-model',
    llmApiKey: 'llm-key',
    llmModel: 'memory-model',
  },
};

class FakeMem0Client {
  readonly items: MemoryItem[] = [
    {
      id: 'memory-a',
      memory: '销售偏好三段式总结。',
      metadata: {
        memory_scope: 'sales-agent-long-term',
        tenant_id: 'tenant-a',
        actor_open_id: 'ou-sales-a',
        category: 'sales_workflow_preference',
      },
      score: 0.9,
    },
    {
      id: 'memory-b',
      memory: '另一个租户的偏好。',
      metadata: {
        memory_scope: 'sales-agent-long-term',
        tenant_id: 'tenant-b',
        actor_open_id: 'ou-sales-b',
        category: 'sales_workflow_preference',
      },
      score: 0.8,
    },
  ];

  lastAddConfig: AddMemoryOptions | null = null;

  async add(
    _messages: string | Message[],
    config: AddMemoryOptions,
  ): Promise<{ results: MemoryItem[] }> {
    this.lastAddConfig = config;
    return { results: [this.items[0]] };
  }

  async search(
    _query: string,
    _config: SearchMemoryOptions,
  ): Promise<{ results: MemoryItem[] }> {
    return { results: this.items };
  }

  async get(memoryId: string): Promise<MemoryItem | null> {
    return this.items.find((item: MemoryItem): boolean => item.id === memoryId)
      ?? null;
  }

  async delete(_memoryId: string): Promise<{ message: string }> {
    return { message: 'deleted' };
  }

  async history(_memoryId: string): Promise<unknown[]> {
    return [{ event: 'ADD', source: 'followup:confirmed:001' }];
  }
}

describe('Mem0MemoryAdapter', (): void => {
  it('does not initialize or write Mem0 when disabled', async (): Promise<void> => {
    const adapter: Mem0MemoryAdapter = new Mem0MemoryAdapter(runtimeConfig);

    expect(adapter.isEnabled()).toBe(false);
    await expect(adapter.addApprovedMemory(scope, approvedMemory))
      .resolves.toEqual({ status: 'disabled', memoryIds: [] });
    await expect(adapter.search(scope, '三段式总结')).resolves.toEqual([]);
    await expect(adapter.delete(scope, 'memory-1')).resolves.toBe(false);
    await expect(adapter.history(scope, 'memory-1')).resolves.toEqual([]);
    await expect(adapter.health()).resolves.toEqual({
      enabled: false,
      ready: false,
      reason: 'Mem0 long-term memory is disabled',
    });
  });

  it('requires tenant and actor boundaries before any operation', async (): Promise<void> => {
    const adapter: Mem0MemoryAdapter = new Mem0MemoryAdapter(runtimeConfig);

    await expect(adapter.search({ tenantId: '', actorOpenId: 'ou-sales-a' }, '偏好'))
      .rejects.toThrow('tenant and actor boundaries');
    await expect(adapter.addApprovedMemory(
      { tenantId: 'tenant-a', actorOpenId: 'ou-sales-a' },
      { ...approvedMemory, approved: false },
    )).rejects.toThrow('explicit approval');
  });

  it('reports configured-but-unavailable Mem0 without enabling writes', async (): Promise<void> => {
    const config: AgentRuntimeConfig = {
      ...runtimeConfig,
      longTermMemory: {
        ...runtimeConfig.longTermMemory,
        enabled: true,
      },
    };
    const adapter: Mem0MemoryAdapter = new Mem0MemoryAdapter(config);

    expect(adapter.isEnabled()).toBe(false);
    await expect(adapter.health()).resolves.toMatchObject({
      enabled: true,
      ready: false,
    });
  });

  it('applies scope filtering before returning or deleting Mem0 records', async (): Promise<void> => {
    const client: FakeMem0Client = new FakeMem0Client();
    const factory: Mem0MemoryFactory = (): FakeMem0Client => client;
    const adapter: Mem0MemoryAdapter = new Mem0MemoryAdapter(enabledConfig, factory);

    await expect(adapter.search(scope, '偏好')).resolves.toEqual([
      expect.objectContaining({ memoryId: 'memory-a' }),
    ]);
    await expect(adapter.delete(scope, 'memory-b')).resolves.toBe(false);
    await expect(adapter.history(scope, 'memory-b')).resolves.toEqual([]);
    await expect(adapter.delete(scope, 'memory-a')).resolves.toBe(true);
    await expect(adapter.addApprovedMemory(scope, approvedMemory)).resolves.toEqual({
      status: 'written',
      memoryIds: ['memory-a'],
    });
    expect(client.lastAddConfig?.userId)
      .toBe('sales-agent-long-term:tenant-a:ou-sales-a');
  });
});
