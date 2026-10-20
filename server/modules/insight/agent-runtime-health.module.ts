import { Module } from '@nestjs/common';

import { ControlDatabaseModule } from
  '@server/modules/control-store/control-database.module';
import { AgentRuntimeHealthController } from './agent-runtime-health.controller';
import { AgentRuntimeHealthService } from './agent-runtime-health.service';

@Module({
  imports: [ControlDatabaseModule],
  controllers: [AgentRuntimeHealthController],
  providers: [AgentRuntimeHealthService],
})
class AgentRuntimeHealthModule {}

export { AgentRuntimeHealthModule };
