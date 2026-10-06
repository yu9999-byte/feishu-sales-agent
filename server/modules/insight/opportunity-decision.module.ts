import { Module } from '@nestjs/common';

import { AgentExecutionModule } from
  '@server/modules/agent-core/agent-execution.module';
import {
  OPPORTUNITY_DECISION_READER,
} from '@server/modules/agent-core/agent.ports';
import { AgentControlModule } from
  '@server/modules/control-store/agent-control.module';
import { PlatformShellModule } from
  '@server/modules/platform-shell/platform-shell.module';
import { WebAuthModule } from '@server/modules/web-auth/web-auth.module';
import { OpportunityDecisionController } from
  './opportunity-decision.controller';
import { OpportunityDecisionService } from './opportunity-decision.service';
import { TaskFulfillmentModule } from './task-fulfillment.module';

@Module({
  imports: [
    AgentControlModule,
    AgentExecutionModule,
    PlatformShellModule,
    WebAuthModule,
    TaskFulfillmentModule,
  ],
  controllers: [OpportunityDecisionController],
  providers: [
    OpportunityDecisionService,
    {
      provide: OPPORTUNITY_DECISION_READER,
      useExisting: OpportunityDecisionService,
    },
  ],
  exports: [OpportunityDecisionService, OPPORTUNITY_DECISION_READER],
})
class OpportunityDecisionModule {}

export { OpportunityDecisionModule };
