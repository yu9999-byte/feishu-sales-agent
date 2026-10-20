import { Module } from '@nestjs/common';

import { AgentExecutionModule } from
  '@server/modules/agent-core/agent-execution.module';
import { AgentControlModule } from
  '@server/modules/control-store/agent-control.module';
import { PlatformShellModule } from
  '@server/modules/platform-shell/platform-shell.module';
import { WebAuthModule } from '@server/modules/web-auth/web-auth.module';
import { ControlDatabaseModule } from '@server/modules/control-store/control-database.module';
import { TaskFulfillmentController } from './task-fulfillment.controller';
import { TaskFulfillmentService } from './task-fulfillment.service';
import { TaskPromiseEvidenceController } from './task-promise-evidence.controller';
import { TaskPromiseEvidenceService } from './task-promise-evidence.service';
import { TASK_PROMISE_EVIDENCE_REPOSITORY } from './task-promise-evidence.ports';
import { PostgresTaskPromiseEvidenceRepository } from './postgres-task-promise-evidence.repository';

@Module({
  imports: [
    AgentControlModule,
    ControlDatabaseModule,
    AgentExecutionModule,
    PlatformShellModule,
    WebAuthModule,
  ],
  controllers: [TaskFulfillmentController, TaskPromiseEvidenceController],
  providers: [TaskFulfillmentService, TaskPromiseEvidenceService, PostgresTaskPromiseEvidenceRepository,
    { provide: TASK_PROMISE_EVIDENCE_REPOSITORY, useExisting: PostgresTaskPromiseEvidenceRepository }],
  exports: [TaskFulfillmentService],
})
class TaskFulfillmentModule {}

export { TaskFulfillmentModule };
