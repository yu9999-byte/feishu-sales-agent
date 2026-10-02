import { Module } from '@nestjs/common';

import { AgentExecutionModule } from
  '@server/modules/agent-core/agent-execution.module';
import { AgentControlModule } from
  '@server/modules/control-store/agent-control.module';
import { PlatformShellModule } from
  '@server/modules/platform-shell/platform-shell.module';
import { WebAuthModule } from '@server/modules/web-auth/web-auth.module';
import { TaskFulfillmentController } from './task-fulfillment.controller';
import { TaskFulfillmentService } from './task-fulfillment.service';

@Module({
  imports: [
    AgentControlModule,
    AgentExecutionModule,
    PlatformShellModule,
    WebAuthModule,
  ],
  controllers: [TaskFulfillmentController],
  providers: [TaskFulfillmentService],
  exports: [TaskFulfillmentService],
})
class TaskFulfillmentModule {}

export { TaskFulfillmentModule };
