import postgres from 'postgres';

import {
  Global,
  Inject,
  Module,
  type OnModuleDestroy,
  type Provider,
} from '@nestjs/common';
import type { Sql } from 'postgres';

import { AGENT_DATABASE } from './postgres-control.store';

const databaseProvider = {
  provide: AGENT_DATABASE,
  useFactory: (): Sql => {
    const databaseUrl: string | undefined = process.env.DATABASE_URL;
    if (!databaseUrl || databaseUrl.trim().length === 0) {
      throw new Error('Missing required environment variable: DATABASE_URL');
    }
    return postgres(databaseUrl, {
      max: 10,
      connect_timeout: 10,
      idle_timeout: 20,
      onnotice: (): void => undefined,
    });
  },
} satisfies Provider;

@Global()
@Module({
  providers: [databaseProvider],
  exports: [AGENT_DATABASE],
})
class ControlDatabaseModule implements OnModuleDestroy {
  constructor(
    @Inject(AGENT_DATABASE)
    private readonly sql: Sql,
  ) {}

  async onModuleDestroy(): Promise<void> {
    await this.sql.end({ timeout: 5 });
  }
}

export { ControlDatabaseModule };
