import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { Memory } from 'mem0ai/oss';

import type {
  AddMemoryOptions,
  MemoryConfig,
  MemoryItem,
  Message,
  SearchMemoryOptions,
} from 'mem0ai/oss';
import type { JsonObject } from '@shared/api.interface';
import {
  AGENT_CONFIG,
  type AgentRuntimeConfig,
  type LongTermMemoryRuntimeConfig,
} from '@server/config/agent.config';
import {
  type ApprovedLongTermMemoryInput,
  type LongTermMemoryHealth,
  type LongTermMemoryItem,
  type LongTermMemoryPort,
  type LongTermMemoryScope,
  type LongTermMemoryWriteResult,
} from './long-term-memory.port';

const MEMORY_NAMESPACE = 'sales-agent-long-term';

export const MEM0_MEMORY_FACTORY = Symbol('MEM0_MEMORY_FACTORY');

interface Mem0MemoryClient {
  add(
    messages: string | Message[],
    config: AddMemoryOptions,
  ): Promise<{ results: MemoryItem[] }>;
  search(
    query: string,
    config: SearchMemoryOptions,
  ): Promise<{ results: MemoryItem[] }>;
  get(memoryId: string): Promise<MemoryItem | null>;
  delete(memoryId: string): Promise<{ message: string }>;
  history(memoryId: string): Promise<unknown[]>;
}

export type Mem0MemoryFactory = (
  settings: LongTermMemoryRuntimeConfig,
) => Mem0MemoryClient;

@Injectable()
export class Mem0MemoryAdapter implements LongTermMemoryPort {
  private readonly logger: Logger = new Logger(Mem0MemoryAdapter.name);

  private readonly memory: Mem0MemoryClient | null;

  private readonly configured: boolean;

  private readonly initializationReason: string | undefined;

  constructor(
    @Inject(AGENT_CONFIG)
    config: AgentRuntimeConfig,
    @Optional()
    @Inject(MEM0_MEMORY_FACTORY)
    memoryFactory?: Mem0MemoryFactory,
  ) {
    const settings: LongTermMemoryRuntimeConfig | undefined =
      config.longTermMemory;
    this.configured = settings?.enabled === true;
    if (!settings?.enabled) {
      this.memory = null;
      this.initializationReason = 'Mem0 long-term memory is disabled';
      return;
    }

    try {
      validateEnabledSettings(settings);
      const factory: Mem0MemoryFactory = memoryFactory ?? createMem0Memory;
      this.memory = factory(settings);
      this.initializationReason = undefined;
    } catch (error: unknown) {
      this.memory = null;
      this.initializationReason = error instanceof Error
        ? error.message
        : String(error);
      this.logger.error(
        `Mem0 long-term memory initialization failed: ${this.initializationReason}`,
      );
    }
  }

  isEnabled(): boolean {
    return this.memory !== null;
  }

  async addApprovedMemory(
    scope: LongTermMemoryScope,
    input: ApprovedLongTermMemoryInput,
  ): Promise<LongTermMemoryWriteResult> {
    const normalizedScope: LongTermMemoryScope = validateScope(scope);
    validateApprovedMemory(input);
    if (this.memory === null) {
      return { status: 'disabled', memoryIds: [] };
    }

    const result = await this.memory.add(
      [{ role: 'user', content: input.text.trim() }],
      {
        userId: namespaceFor(normalizedScope),
        metadata: createMetadata(normalizedScope, input),
        infer: true,
        expirationDate: input.expiresAt?.toISOString().slice(0, 10),
      },
    );
    return {
      status: 'written',
      memoryIds: result.results.map((item: MemoryItem): string => item.id),
    };
  }

  async search(
    scope: LongTermMemoryScope,
    query: string,
    limit: number = 5,
  ): Promise<LongTermMemoryItem[]> {
    const normalizedScope: LongTermMemoryScope = validateScope(scope);
    if (query.trim().length === 0 || this.memory === null) {
      return [];
    }
    const safeLimit: number = Math.min(Math.max(Math.trunc(limit), 1), 20);
    const options: SearchMemoryOptions = {
      topK: safeLimit,
      filters: {
        user_id: namespaceFor(normalizedScope),
        tenant_id: normalizedScope.tenantId,
        actor_open_id: normalizedScope.actorOpenId,
        ...(normalizedScope.customerRef === undefined
          ? {}
          : { customer_ref: normalizedScope.customerRef }),
      },
    };
    const result = await this.memory.search(query.trim(), options);
    return result.results
      .filter((item: MemoryItem): boolean =>
        belongsToScope(item, normalizedScope),
      )
      .map((item: MemoryItem): LongTermMemoryItem => ({
        memoryId: item.id,
        text: item.memory,
        score: item.score,
        metadata: knownMetadata(item.metadata),
      }));
  }

  async delete(
    scope: LongTermMemoryScope,
    memoryId: string,
  ): Promise<boolean> {
    const normalizedScope: LongTermMemoryScope = validateScope(scope);
    if (memoryId.trim().length === 0 || this.memory === null) {
      return false;
    }
    const item: MemoryItem | null = await this.memory.get(memoryId);
    if (item === null || !belongsToScope(item, normalizedScope)) {
      return false;
    }
    await this.memory.delete(memoryId);
    return true;
  }

  async history(
    scope: LongTermMemoryScope,
    memoryId: string,
  ): Promise<JsonObject[]> {
    const normalizedScope: LongTermMemoryScope = validateScope(scope);
    if (memoryId.trim().length === 0 || this.memory === null) {
      return [];
    }
    const item: MemoryItem | null = await this.memory.get(memoryId);
    if (item === null || !belongsToScope(item, normalizedScope)) {
      return [];
    }
    const records: unknown[] = await this.memory.history(memoryId);
    return records.filter(isJsonObject);
  }

  async health(): Promise<LongTermMemoryHealth> {
    if (this.memory === null) {
      return {
        enabled: this.configured,
        ready: false,
        reason: this.initializationReason,
      };
    }
    return { enabled: true, ready: true };
  }
}

const validateScope = (scope: LongTermMemoryScope): LongTermMemoryScope => {
  const tenantId: string = scope.tenantId.trim();
  const actorOpenId: string = scope.actorOpenId.trim();
  const customerRef: string | undefined = scope.customerRef?.trim();
  if (tenantId.length === 0 || actorOpenId.length === 0) {
    throw new Error('Long-term memory requires tenant and actor boundaries');
  }
  if (scope.customerRef !== undefined && (!customerRef || customerRef.length === 0)) {
    throw new Error('Long-term memory customerRef cannot be empty');
  }
  return { tenantId, actorOpenId, customerRef };
};

const validateApprovedMemory = (
  input: ApprovedLongTermMemoryInput,
): void => {
  if (input.approved !== true) {
    throw new Error('Long-term memory requires explicit approval');
  }
  if (input.text.trim().length === 0) {
    throw new Error('Long-term memory text cannot be empty');
  }
  if (input.sourceRef.trim().length === 0 || input.policyVersion.trim().length === 0) {
    throw new Error('Long-term memory requires source and policy references');
  }
  if (input.approvedBy.trim().length === 0) {
    throw new Error('Long-term memory requires an approver');
  }
};

const namespaceFor = (scope: LongTermMemoryScope): string =>
  `${MEMORY_NAMESPACE}:${scope.tenantId}:${scope.actorOpenId}`;

const createMetadata = (
  scope: LongTermMemoryScope,
  input: ApprovedLongTermMemoryInput,
): JsonObject => ({
  memory_scope: MEMORY_NAMESPACE,
  tenant_id: scope.tenantId,
  actor_open_id: scope.actorOpenId,
  ...(scope.customerRef === undefined ? {} : { customer_ref: scope.customerRef }),
  category: input.category,
  source_ref: input.sourceRef,
  policy_version: input.policyVersion,
  approved_by: input.approvedBy,
});

const belongsToScope = (
  item: MemoryItem,
  scope: LongTermMemoryScope,
): boolean => {
  const metadata: Record<string, unknown> = item.metadata ?? {};
  return metadata.memory_scope === MEMORY_NAMESPACE
    && metadata.tenant_id === scope.tenantId
    && metadata.actor_open_id === scope.actorOpenId
    && (scope.customerRef === undefined
      || metadata.customer_ref === scope.customerRef);
};

const knownMetadata = (metadata: Record<string, unknown> | undefined): JsonObject => {
  if (metadata === undefined) {
    return {};
  }
  const allowedKeys: string[] = [
    'memory_scope',
    'tenant_id',
    'actor_open_id',
    'customer_ref',
    'category',
    'source_ref',
    'policy_version',
    'approved_by',
  ];
  return allowedKeys.reduce((result: JsonObject, key: string): JsonObject => {
    const value: unknown = metadata[key];
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      result[key] = value;
    }
    return result;
  }, {});
};

const isJsonObject = (value: unknown): value is JsonObject =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const validateEnabledSettings = (
  settings: LongTermMemoryRuntimeConfig,
): void => {
  const missing: string[] = [];
  if (!settings.vectorStoreUrl && settings.vectorStoreProvider === 'qdrant') {
    missing.push('MEM0_VECTOR_STORE_URL');
  }
  if (!settings.llmApiKey) {
    missing.push('MEM0_LLM_API_KEY or LLM_API_KEY');
  }
  if (!settings.llmModel) {
    missing.push('MEM0_LLM_MODEL or LLM_MODEL');
  }
  if (!settings.embedderApiKey) {
    missing.push('MEM0_EMBEDDER_API_KEY or LLM_API_KEY');
  }
  if (!settings.embedderModel) {
    missing.push('MEM0_EMBEDDER_MODEL');
  }
  if (missing.length > 0) {
    throw new Error(`Mem0 configuration is incomplete: ${missing.join(', ')}`);
  }
};

const createMem0Config = (
  settings: LongTermMemoryRuntimeConfig,
): Partial<MemoryConfig> => ({
  embedder: {
    provider: settings.embedderProvider,
    config: {
      apiKey: settings.embedderApiKey,
      model: settings.embedderModel,
      baseURL: settings.embedderBaseUrl,
      embeddingDims: settings.embedderDimension,
    },
  },
  vectorStore: {
    provider: settings.vectorStoreProvider,
    config: {
      url: settings.vectorStoreUrl,
      collectionName: settings.vectorStoreCollection,
      dimension: settings.vectorStoreDimension,
    },
  },
  llm: {
    provider: settings.llmProvider,
    config: {
      apiKey: settings.llmApiKey,
      model: settings.llmModel,
      baseURL: settings.llmBaseUrl,
    },
  },
  ...(settings.historyDbPath === undefined
    ? {}
    : { historyDbPath: settings.historyDbPath }),
});

const createMem0Memory: Mem0MemoryFactory = (
  settings: LongTermMemoryRuntimeConfig,
): Mem0MemoryClient => new Memory(createMem0Config(settings));
