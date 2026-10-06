import { Module } from '@nestjs/common';

import { agentConfigProvider } from '@server/config/agent.providers';
import {
  AGENT_CONFIG,
  type AgentRuntimeConfig,
} from '@server/config/agent.config';
import { AgentExecutionModule } from '@server/modules/agent-core/agent-execution.module';
import {
  CONTROL_STORE,
  SALES_RECORDS_GATEWAY,
  TASK_GATEWAY,
} from '@server/modules/agent-core/agent.ports';
import { AgentControlModule } from '@server/modules/control-store/agent-control.module';
import { FeishuApiModule } from '@server/modules/feishu/feishu-api.module';
import { FeishuClientFactory } from
  '@server/modules/feishu/feishu-client.factory';
import { FeishuStaleOpportunityReminderSender } from
  '@server/modules/feishu/feishu-stale-opportunity-reminder.sender';
import { IdentityAccessModule } from '@server/modules/identity-access/identity-access.module';
import { PlatformShellModule } from '@server/modules/platform-shell/platform-shell.module';
import { WebAuthModule } from '@server/modules/web-auth/web-auth.module';
import { StaleOpportunityContextService } from
  './stale-opportunity-context.service';
import { StaleOpportunityHistoryGovernanceEvidenceService } from
  './stale-opportunity-history-governance-evidence.service';
import { PostgresStaleOpportunityReminderStore } from
  './postgres-stale-opportunity-reminder.store';
import { StaleOpportunityReadinessController } from
  './stale-opportunity-readiness.controller';
import { StaleOpportunityReminderPlanService } from
  './stale-opportunity-reminder-plan.service';
import { StaleOpportunityReminderCoordinatorService } from
  './stale-opportunity-reminder-coordinator.service';
import { StaleOpportunityReminderExecutionService } from
  './stale-opportunity-reminder-execution.service';
import { StaleOpportunityReminderExecutionReadinessService } from
  './stale-opportunity-reminder-execution-readiness.service';
import { StaleOpportunityReminderSenderEvidenceService } from
  './stale-opportunity-reminder-sender-evidence.service';
import { StaleOpportunityReminderService } from
  './stale-opportunity-reminder.service';
import { StaleOpportunityScanService } from
  './stale-opportunity-scan.service';
import { PlatformSessionService } from
  '@server/modules/platform-shell/platform-session.service';
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
    FeishuApiModule,
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
    StaleOpportunityHistoryGovernanceEvidenceService,
    StaleOpportunityTriggerService,
    StaleOpportunityReminderRuntimeService,
    StaleOpportunityReminderPlanService,
    StaleOpportunityReminderSenderEvidenceService,
    StaleOpportunityReminderExecutionReadinessService,
    {
      provide: FeishuStaleOpportunityReminderSender,
      useFactory: (
        control: ConstructorParameters<
          typeof FeishuStaleOpportunityReminderSender
        >[0],
        clients: FeishuClientFactory,
      ): FeishuStaleOpportunityReminderSender =>
        new FeishuStaleOpportunityReminderSender(control, clients),
      inject: [CONTROL_STORE, FeishuClientFactory],
    },
    {
      provide: StaleOpportunityReminderService,
      useFactory: (
        store: PostgresStaleOpportunityReminderStore,
        sender: FeishuStaleOpportunityReminderSender,
      ): StaleOpportunityReminderService =>
        new StaleOpportunityReminderService(store, sender),
      inject: [
        PostgresStaleOpportunityReminderStore,
        FeishuStaleOpportunityReminderSender,
      ],
    },
    {
      provide: StaleOpportunityReminderCoordinatorService,
      useFactory: (
        control: ConstructorParameters<
          typeof StaleOpportunityReminderCoordinatorService
        >[0],
        sessions: PlatformSessionService,
        records: ConstructorParameters<typeof StaleOpportunityScanService>[0],
        tasks: ConstructorParameters<typeof StaleOpportunityScanService>[1],
        reminders: StaleOpportunityReminderService,
      ): StaleOpportunityReminderCoordinatorService =>
        new StaleOpportunityReminderCoordinatorService(
          control,
          sessions,
          new StaleOpportunityScanService(records, tasks),
          reminders,
        ),
      inject: [
        CONTROL_STORE,
        PlatformSessionService,
        SALES_RECORDS_GATEWAY,
        TASK_GATEWAY,
        StaleOpportunityReminderService,
      ],
    },
    {
      provide: StaleOpportunityReminderExecutionService,
      useFactory: (
        config: AgentRuntimeConfig,
        planner: StaleOpportunityReminderPlanService,
        coordinator: StaleOpportunityReminderCoordinatorService,
        governance: StaleOpportunityHistoryGovernanceEvidenceService,
        sender: StaleOpportunityReminderSenderEvidenceService,
      ): StaleOpportunityReminderExecutionService =>
        new StaleOpportunityReminderExecutionService(
          config,
          planner,
          coordinator,
          governance,
          sender,
        ),
      inject: [
        AGENT_CONFIG,
        StaleOpportunityReminderPlanService,
        StaleOpportunityReminderCoordinatorService,
        StaleOpportunityHistoryGovernanceEvidenceService,
        StaleOpportunityReminderSenderEvidenceService,
      ],
    },
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
