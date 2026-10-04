import { Module } from '@nestjs/common';

import { agentConfigProvider } from '@server/config/agent.providers';
import { AgentExecutionModule } from '@server/modules/agent-core/agent-execution.module';
import { AgentControlModule } from '@server/modules/control-store/agent-control.module';
import { IdentityAccessModule } from '@server/modules/identity-access/identity-access.module';
import { PlatformShellModule } from '@server/modules/platform-shell/platform-shell.module';
import { WebAuthModule } from '@server/modules/web-auth/web-auth.module';
import { StaleOpportunityContextService } from
  './stale-opportunity-context.service';
import { PostgresStaleOpportunityReminderStore } from
  './postgres-stale-opportunity-reminder.store';
import { StaleOpportunityReadinessController } from
  './stale-opportunity-readiness.controller';
import { StaleOpportunityReminderPlanService } from
  './stale-opportunity-reminder-plan.service';
import {
  STALE_OPPORTUNITY_REMINDER_RECONCILER,
  StaleOpportunityReminderReconciliationService,
} from './stale-opportunity-reminder-reconciliation.service';
import { StaleOpportunityReminderReconciliationController } from
  './stale-opportunity-reminder-reconciliation.controller';
import { StaleOpportunityReminderRuntimeController } from
  './stale-opportunity-reminder-runtime.controller';
import { StaleOpportunityReadinessService } from
  './stale-opportunity-readiness.service';
import { StaleOpportunityTriggerController } from
  './stale-opportunity-trigger.controller';
import { StaleOpportunityTriggerService } from
  './stale-opportunity-trigger.service';
import {
  STALE_OPPORTUNITY_REMINDER_UNCERTAIN_READER,
  StaleOpportunityReminderRuntimeService,
} from './stale-opportunity-reminder-runtime.service';

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
    StaleOpportunityReminderRuntimeController,
    StaleOpportunityReminderReconciliationController,
  ],
  providers: [
    agentConfigProvider,
    StaleOpportunityContextService,
    PostgresStaleOpportunityReminderStore,
    StaleOpportunityReadinessService,
    StaleOpportunityTriggerService,
    StaleOpportunityReminderRuntimeService,
    StaleOpportunityReminderPlanService,
    StaleOpportunityReminderReconciliationService,
    {
      provide: STALE_OPPORTUNITY_REMINDER_RECONCILER,
      useExisting: PostgresStaleOpportunityReminderStore,
    },
    {
      provide: STALE_OPPORTUNITY_REMINDER_UNCERTAIN_READER,
      useExisting: PostgresStaleOpportunityReminderStore,
    },
  ],
  exports: [StaleOpportunityReminderRuntimeService],
})
class StaleOpportunityReadinessModule {}

export { StaleOpportunityReadinessModule };
