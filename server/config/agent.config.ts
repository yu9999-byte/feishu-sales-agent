export const AGENT_CONFIG = Symbol('AGENT_CONFIG');

export interface LongTermMemoryRuntimeConfig {
  enabled: boolean;
  vectorStoreProvider: string;
  vectorStoreUrl: string | undefined;
  vectorStoreCollection: string;
  vectorStoreDimension: number | undefined;
  embedderProvider: string;
  embedderApiKey: string | undefined;
  embedderModel: string | undefined;
  embedderBaseUrl: string | undefined;
  embedderDimension: number | undefined;
  llmProvider: string;
  llmApiKey: string | undefined;
  llmModel: string | undefined;
  llmBaseUrl: string | undefined;
  historyDbPath: string | undefined;
}

export interface AgentRuntimeConfig {
  host: string;
  port: number;
  executionTimeoutMs?: number;
  conversationThreadTtlMs?: number;
  databaseUrl: string;
  llm: {
    baseUrl: string;
    apiKey: string;
    model: string;
  };
  feishu: {
    verificationToken: string;
    encryptKey: string | undefined;
  };
  longTermMemory?: LongTermMemoryRuntimeConfig;
}

const requireEnvironment = (name: string): string => {
  const value: string | undefined = process.env[name];
  if (!value || value.trim().length === 0) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
};

const optionalEnvironment = (name: string): string | undefined => {
  const value: string | undefined = process.env[name]?.trim();
  return value && value.length > 0 ? value : undefined;
};

const parsePort = (value: string | undefined): number => {
  const port: number = Number(value ?? '3100');
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('AGENT_PORT must be an integer between 1 and 65535');
  }
  return port;
};

const parseBoolean = (value: string | undefined, fallback: boolean): boolean => {
  if (value === undefined) {
    return fallback;
  }
  return value.trim().toLowerCase() === 'true';
};

const parsePositiveInteger = (value: string | undefined): number | undefined => {
  if (value === undefined || value.trim().length === 0) {
    return undefined;
  }
  const parsed: number = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error('Memory dimension must be a positive integer');
  }
  return parsed;
};

const loadAgentConfig = (): AgentRuntimeConfig => ({
  host: process.env.AGENT_HOST?.trim() || '0.0.0.0',
  port: parsePort(process.env.AGENT_PORT),
  executionTimeoutMs: parsePositiveInteger(
    process.env.AGENT_EXECUTION_TIMEOUT_MS,
  ) ?? 5 * 60 * 1000,
  conversationThreadTtlMs: parsePositiveInteger(
    process.env.LANGGRAPH_THREAD_TTL_MS,
  ) ?? 24 * 60 * 60 * 1000,
  databaseUrl: requireEnvironment('DATABASE_URL'),
  llm: {
    baseUrl: requireEnvironment('LLM_BASE_URL').replace(/\/$/u, ''),
    apiKey: requireEnvironment('LLM_API_KEY'),
    model: requireEnvironment('LLM_MODEL'),
  },
  feishu: {
    verificationToken: requireEnvironment('FEISHU_VERIFICATION_TOKEN'),
    encryptKey: optionalEnvironment('FEISHU_ENCRYPT_KEY'),
  },
  longTermMemory: {
    enabled: parseBoolean(process.env.MEM0_ENABLED, false),
    vectorStoreProvider: process.env.MEM0_VECTOR_STORE_PROVIDER?.trim()
      || 'qdrant',
    vectorStoreUrl: optionalEnvironment('MEM0_VECTOR_STORE_URL'),
    vectorStoreCollection: process.env.MEM0_VECTOR_STORE_COLLECTION?.trim()
      || 'sales_agent_memory',
    vectorStoreDimension: parsePositiveInteger(
      process.env.MEM0_VECTOR_STORE_DIMENSION,
    ),
    embedderProvider: process.env.MEM0_EMBEDDER_PROVIDER?.trim() || 'openai',
    embedderApiKey: optionalEnvironment('MEM0_EMBEDDER_API_KEY')
      || optionalEnvironment('LLM_API_KEY'),
    embedderModel: optionalEnvironment('MEM0_EMBEDDER_MODEL'),
    embedderBaseUrl: optionalEnvironment('MEM0_EMBEDDER_BASE_URL')
      || optionalEnvironment('LLM_BASE_URL'),
    embedderDimension: parsePositiveInteger(process.env.MEM0_EMBEDDER_DIMENSION),
    llmProvider: process.env.MEM0_LLM_PROVIDER?.trim() || 'openai',
    llmApiKey: optionalEnvironment('MEM0_LLM_API_KEY')
      || optionalEnvironment('LLM_API_KEY'),
    llmModel: optionalEnvironment('MEM0_LLM_MODEL')
      || optionalEnvironment('LLM_MODEL'),
    llmBaseUrl: optionalEnvironment('MEM0_LLM_BASE_URL')
      || optionalEnvironment('LLM_BASE_URL'),
    historyDbPath: optionalEnvironment('MEM0_HISTORY_DB_PATH'),
  },
});

export { loadAgentConfig };
