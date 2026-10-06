import { Module } from '@nestjs/common';

import { AgentExecutionModule } from '@server/modules/agent-core/agent-execution.module';
import { AgentControlModule } from '@server/modules/control-store/agent-control.module';
import { IdentityAccessModule } from '@server/modules/identity-access/identity-access.module';
import { PlatformShellModule } from '@server/modules/platform-shell/platform-shell.module';
import { WebAuthModule } from '@server/modules/web-auth/web-auth.module';
import { DailyReportModule } from './daily-report.module';
import { OpportunityDecisionModule } from './opportunity-decision.module';
import { TeamOpportunityDecisionController } from
  './team-opportunity-decision.controller';
import { TeamOpportunityDecisionService } from
  './team-opportunity-decision.service';
import { TeamReviewController } from './team-review.controller';
import { TeamReviewService } from './team-review.service';

@Module({
  imports: [
    AgentControlModule,
    AgentExecutionModule,
    DailyReportModule,
    IdentityAccessModule,
    OpportunityDecisionModule,
    PlatformShellModule,
    WebAuthModule,
  ],
  controllers: [TeamReviewController, TeamOpportunityDecisionController],
  providers: [TeamReviewService, TeamOpportunityDecisionService],
})
class TeamReviewModule {}

export { TeamReviewModule };
