import { Module } from '@nestjs/common';

import { AgentExecutionModule } from '@server/modules/agent-core/agent-execution.module';
import { AgentControlModule } from '@server/modules/control-store/agent-control.module';
import { ControlDatabaseModule } from '@server/modules/control-store/control-database.module';
import { PlatformShellModule } from '@server/modules/platform-shell/platform-shell.module';
import { WebAuthModule } from '@server/modules/web-auth/web-auth.module';
import { FeishuApiModule } from '@server/modules/feishu/feishu-api.module';
import { FeishuMinutesGateway } from
  '@server/modules/feishu/feishu-minutes.gateway';
import { FollowupDraftController } from './followup-draft.controller';
import {
  FOLLOWUP_DRAFT_REPOSITORY,
} from './followup-draft.repository';
import { FollowupDraftWorkflowService } from './followup-draft-workflow.service';
import { FollowupConfirmationService } from './followup-confirmation.service';
import { FollowupChatDraftService } from './followup-chat-draft.service';
import { FollowupQualityService } from './followup-quality.service';
import { FollowupProgressService } from './followup-progress.service';
import { PostgresFollowupDraftRepository } from './postgres-followup-draft.repository';
import {
  MINUTES_TRANSCRIPT_GATEWAY,
  MinutesIngestionService,
} from './minutes-ingestion.service';

@Module({
  imports: [
    ControlDatabaseModule,
    AgentControlModule,
    AgentExecutionModule,
    FeishuApiModule,
    WebAuthModule,
    PlatformShellModule,
  ],
  controllers: [FollowupDraftController],
  providers: [
    PostgresFollowupDraftRepository,
    FollowupQualityService,
    FollowupProgressService,
    FollowupChatDraftService,
    FollowupDraftWorkflowService,
    FollowupConfirmationService,
    FeishuMinutesGateway,
    MinutesIngestionService,
    {
      provide: FOLLOWUP_DRAFT_REPOSITORY,
      useExisting: PostgresFollowupDraftRepository,
    },
    {
      provide: MINUTES_TRANSCRIPT_GATEWAY,
      useExisting: FeishuMinutesGateway,
    },
  ],
  exports: [FollowupChatDraftService, MinutesIngestionService],
})
class SalesBehaviorModule {}

export { SalesBehaviorModule };
