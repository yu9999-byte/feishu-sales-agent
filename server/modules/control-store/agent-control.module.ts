import { Module } from '@nestjs/common';

import {
  CONTROL_STORE,
} from '@server/modules/agent-core/agent.ports';
import { ControlDatabaseModule } from './control-database.module';
import { PostgresControlStore } from './postgres-control.store';

@Module({
  imports: [ControlDatabaseModule],
  providers: [
    PostgresControlStore,
    {
      provide: CONTROL_STORE,
      useExisting: PostgresControlStore,
    },
  ],
  exports: [CONTROL_STORE],
})
class AgentControlModule {}

export { AgentControlModule };
