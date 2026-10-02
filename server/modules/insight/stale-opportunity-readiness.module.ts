import { Module } from '@nestjs/common';

import { AgentExecutionModule } from '@server/modules/agent-core/agent-execution.module';
import { AgentControlModule } from '@server/modules/control-store/agent-control.module';
import { PlatformShellModule } from '@server/modules/platform-shell/platform-shell.module';
import { WebAuthModule } from '@server/modules/web-auth/web-auth.module';
import { StaleOpportunityContextService } from
  './stale-opportunity-context.service';
import { StaleOpportunityReadinessController } from
  './stale-opportunity-readiness.controller';
import { StaleOpportunityReadinessService } from
  './stale-opportunity-readiness.service';

@Module({
  imports: [
    AgentControlModule,
    AgentExecutionModule,
    PlatformShellModule,
    WebAuthModule,
  ],
  controllers: [StaleOpportunityReadinessController],
  providers: [
    StaleOpportunityContextService,
    StaleOpportunityReadinessService,
  ],
})
class StaleOpportunityReadinessModule {}

export { StaleOpportunityReadinessModule };
