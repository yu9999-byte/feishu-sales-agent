import { Module } from '@nestjs/common';

import { AgentExecutionModule } from '@server/modules/agent-core/agent-execution.module';
import { AgentControlModule } from '@server/modules/control-store/agent-control.module';
import { IdentityAccessModule } from '@server/modules/identity-access/identity-access.module';
import { PlatformShellModule } from '@server/modules/platform-shell/platform-shell.module';
import { WebAuthModule } from '@server/modules/web-auth/web-auth.module';
import { DailyReportModule } from './daily-report.module';
import { TeamReviewController } from './team-review.controller';
import { TeamReviewService } from './team-review.service';

@Module({
  imports: [
    AgentControlModule,
    AgentExecutionModule,
    DailyReportModule,
    IdentityAccessModule,
    PlatformShellModule,
    WebAuthModule,
  ],
  controllers: [TeamReviewController],
  providers: [TeamReviewService],
})
class TeamReviewModule {}

export { TeamReviewModule };
