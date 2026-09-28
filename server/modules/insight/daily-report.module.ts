import { Module } from '@nestjs/common';

import { AgentExecutionModule } from '@server/modules/agent-core/agent-execution.module';
import { AgentControlModule } from '@server/modules/control-store/agent-control.module';
import { PlatformShellModule } from '@server/modules/platform-shell/platform-shell.module';
import { WebAuthModule } from '@server/modules/web-auth/web-auth.module';
import { DailyReportController } from './daily-report.controller';
import { DailySalesReportService } from './daily-sales-report.service';

@Module({
  imports: [
    AgentControlModule,
    AgentExecutionModule,
    PlatformShellModule,
    WebAuthModule,
  ],
  controllers: [DailyReportController],
  providers: [DailySalesReportService],
})
class DailyReportModule {}

export { DailyReportModule };
