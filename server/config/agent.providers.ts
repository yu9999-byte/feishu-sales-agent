import postgres from 'postgres';

import type { Provider } from '@nestjs/common';
import type { Sql } from 'postgres';
import {
  AGENT_CONFIG,
  loadAgentConfig,
  type AgentRuntimeConfig,
} from './agent.config';
import { AGENT_DATABASE } from '@server/modules/control-store/postgres-control.store';

const createAgentDatabase = (config: AgentRuntimeConfig): Sql =>
  postgres(config.databaseUrl, {
    max: 10,
    connect_timeout: 10,
    idle_timeout: 20,
    onnotice: (): void => undefined,
  });

const agentConfigProvider = {
  provide: AGENT_CONFIG,
  useFactory: loadAgentConfig,
} satisfies Provider;

const agentDatabaseProvider = {
  provide: AGENT_DATABASE,
  inject: [AGENT_CONFIG],
  useFactory: createAgentDatabase,
} satisfies Provider;

export { agentConfigProvider, agentDatabaseProvider };
