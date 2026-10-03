import { Module } from '@nestjs/common';

import { agentConfigProvider } from '@server/config/agent.providers';
import { AgentExecutionModule } from '@server/modules/agent-core/agent-execution.module';
import { AgentControlModule } from '@server/modules/control-store/agent-control.module';
import { IdentityAccessModule } from '@server/modules/identity-access/identity-access.module';
import { PlatformShellModule } from '@server/modules/platform-shell/platform-shell.module';
import { WebAuthModule } from '@server/modules/web-auth/web-auth.module';
import { StaleOpportunityContextService } from
  './stale-opportunity-context.service';
import { StaleOpportunityReadinessController } from
  './stale-opportunity-readiness.controller';
import { StaleOpportunityReadinessService } from
  './stale-opportunity-readiness.service';
import { StaleOpportunityTriggerController } from
  './stale-opportunity-trigger.controller';
import { StaleOpportunityTriggerService } from
  './stale-opportunity-trigger.service';

@Module({
  imports: [
    AgentControlModule,
    AgentExecutionModule,
    IdentityAccessModule,
    PlatformShellModule,
    WebAuthModule,
  ],
  controllers: [
    StaleOpportunityReadinessController,
    StaleOpportunityTriggerController,
  ],
  providers: [
    agentConfigProvider,
    StaleOpportunityContextService,
    StaleOpportunityReadinessService,
    StaleOpportunityTriggerService,
  ],
})
class StaleOpportunityReadinessModule {}

export { StaleOpportunityReadinessModule };
