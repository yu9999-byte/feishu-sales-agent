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
import { SalesMaterialModule } from
  '@server/modules/knowledge/sales-material.module';
import { CustomerVisitBriefingController } from
  './customer-visit-briefing.controller';
import { CustomerVisitBriefingService } from
  './customer-visit-briefing.service';
import { CustomerCommunicationPreparationController } from
  './customer-communication-preparation.controller';
import { CustomerCommunicationPreparationService } from
  './customer-communication-preparation.service';
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
    SalesMaterialModule,
    TaskFulfillmentModule,
  ],
  controllers: [
    OpportunityDecisionController,
    CustomerVisitBriefingController,
    CustomerCommunicationPreparationController,
  ],
  providers: [
    OpportunityDecisionService,
    CustomerVisitBriefingService,
    CustomerCommunicationPreparationService,
    {
      provide: OPPORTUNITY_DECISION_READER,
      useExisting: OpportunityDecisionService,
    },
  ],
  exports: [OpportunityDecisionService, OPPORTUNITY_DECISION_READER],
})
class OpportunityDecisionModule {}

export { OpportunityDecisionModule };
