import { Module } from '@nestjs/common';

import { AgentExecutionModule } from '@server/modules/agent-core/agent-execution.module';
import { AgentControlModule } from '@server/modules/control-store/agent-control.module';
import { ControlDatabaseModule } from '@server/modules/control-store/control-database.module';
import { PlatformShellModule } from '@server/modules/platform-shell/platform-shell.module';
import { WebAuthModule } from '@server/modules/web-auth/web-auth.module';
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

@Module({
  imports: [
    ControlDatabaseModule,
    AgentControlModule,
    AgentExecutionModule,
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
    {
      provide: FOLLOWUP_DRAFT_REPOSITORY,
      useExisting: PostgresFollowupDraftRepository,
    },
  ],
  exports: [FollowupChatDraftService],
})
class SalesBehaviorModule {}

export { SalesBehaviorModule };
