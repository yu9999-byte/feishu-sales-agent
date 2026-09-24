import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { PostgresSaver } from '@langchain/langgraph-checkpoint-postgres';
import type { BaseCheckpointSaver } from '@langchain/langgraph-checkpoint';

import {
  AGENT_CONFIG,
  type AgentRuntimeConfig,
} from '@server/config/agent.config';

export const LANGGRAPH_CHECKPOINTER = Symbol('LANGGRAPH_CHECKPOINTER');

export interface LangGraphCheckpointPort {
  getSaver(): BaseCheckpointSaver;
  ensureReady(): Promise<void>;
}

@Injectable()
export class LangGraphCheckpointerService
  implements LangGraphCheckpointPort, OnApplicationShutdown
{
  private readonly logger: Logger = new Logger(
    LangGraphCheckpointerService.name,
  );

  private readonly saver: PostgresSaver;

  private setupPromise: Promise<void> | null = null;

  constructor(
    @Inject(AGENT_CONFIG)
    config: AgentRuntimeConfig,
  ) {
    this.saver = PostgresSaver.fromConnString(config.databaseUrl, {
      schema: 'langgraph',
    });
  }

  getSaver(): BaseCheckpointSaver {
    return this.saver;
  }

  async ensureReady(): Promise<void> {
    if (this.setupPromise === null) {
      this.setupPromise = this.saver.setup().catch((error: unknown): never => {
        this.setupPromise = null;
        const reason: string = error instanceof Error
          ? error.message
          : String(error);
        this.logger.error(`LangGraph checkpointer setup failed: ${reason}`);
        throw error;
      });
    }
    await this.setupPromise;
  }

  async shutdown(): Promise<void> {
    await this.saver.end();
  }

  async onApplicationShutdown(): Promise<void> {
    await this.shutdown();
  }
}
