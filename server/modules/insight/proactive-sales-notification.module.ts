import { Module } from '@nestjs/common';

import { agentConfigProvider } from '@server/config/agent.providers';
import { AGENT_CONFIG, type AgentRuntimeConfig } from
  '@server/config/agent.config';
import {
  CONTROL_STORE,
  type ControlStore,
} from '@server/modules/agent-core/agent.ports';
import { AgentControlModule } from
  '@server/modules/control-store/agent-control.module';
import { FeishuApiModule } from '@server/modules/feishu/feishu-api.module';
import { FeishuClientFactory } from
  '@server/modules/feishu/feishu-client.factory';
import { FeishuProactiveNotificationSender } from
  '@server/modules/feishu/feishu-proactive-notification.sender';
import { IdentityAccessModule } from
  '@server/modules/identity-access/identity-access.module';
import {
  IDENTITY_ACCESS_REPOSITORY,
  type IdentityAccessRepository,
} from '@server/modules/identity-access/identity-access.ports';
import { PlatformSessionService } from
  '@server/modules/platform-shell/platform-session.service';
import { PlatformShellModule } from
  '@server/modules/platform-shell/platform-shell.module';
import { DailyReportModule } from './daily-report.module';
import { DailySalesReportService } from './daily-sales-report.service';
import { OpportunityDecisionModule } from './opportunity-decision.module';
import { OpportunityDecisionService } from './opportunity-decision.service';
import {
  ProactiveNotificationDeliveryService,
} from './proactive-notification-delivery.service';
import { ProactiveNotificationPlannerService } from
  './proactive-notification-planner.service';
import { ProactiveSalesNotificationController } from
  './proactive-sales-notification.controller';
import { ProactiveSalesNotificationService } from
  './proactive-sales-notification.service';
import { PostgresProactiveNotificationStore } from
  './postgres-proactive-notification.store';
import { TaskFulfillmentModule } from './task-fulfillment.module';
import { TaskFulfillmentService } from './task-fulfillment.service';
import { TeamReviewModule } from './team-review.module';
import { TeamReviewService } from './team-review.service';

@Module({
  imports: [
    AgentControlModule,
    DailyReportModule,
    FeishuApiModule,
    IdentityAccessModule,
    OpportunityDecisionModule,
    PlatformShellModule,
    TaskFulfillmentModule,
    TeamReviewModule,
  ],
  controllers: [ProactiveSalesNotificationController],
  providers: [
    agentConfigProvider,
    PostgresProactiveNotificationStore,
    {
      provide: FeishuProactiveNotificationSender,
      inject: [CONTROL_STORE, FeishuClientFactory],
      useFactory: (
        control: ControlStore,
        clients: FeishuClientFactory,
      ): FeishuProactiveNotificationSender =>
        new FeishuProactiveNotificationSender(control, clients),
    },
    {
      provide: ProactiveNotificationDeliveryService,
      inject: [
        PostgresProactiveNotificationStore,
        FeishuProactiveNotificationSender,
      ],
      useFactory: (
        store: PostgresProactiveNotificationStore,
        sender: FeishuProactiveNotificationSender,
      ): ProactiveNotificationDeliveryService =>
        new ProactiveNotificationDeliveryService(store, sender),
    },
    {
      provide: ProactiveNotificationPlannerService,
      inject: [PostgresProactiveNotificationStore],
      useFactory: (
        store: PostgresProactiveNotificationStore,
      ): ProactiveNotificationPlannerService =>
        new ProactiveNotificationPlannerService(store),
    },
    {
      provide: ProactiveSalesNotificationService,
      inject: [
        AGENT_CONFIG,
        CONTROL_STORE,
        IDENTITY_ACCESS_REPOSITORY,
        PlatformSessionService,
        TaskFulfillmentService,
        OpportunityDecisionService,
        DailySalesReportService,
        TeamReviewService,
        ProactiveNotificationPlannerService,
        ProactiveNotificationDeliveryService,
        PostgresProactiveNotificationStore,
      ],
      useFactory: (
        config: AgentRuntimeConfig,
        control: ControlStore,
        identity: IdentityAccessRepository,
        sessions: PlatformSessionService,
        tasks: TaskFulfillmentService,
        opportunities: OpportunityDecisionService,
        dailyReports: DailySalesReportService,
        teamReviews: TeamReviewService,
        planner: ProactiveNotificationPlannerService,
        delivery: ProactiveNotificationDeliveryService,
        riskStates: PostgresProactiveNotificationStore,
      ): ProactiveSalesNotificationService => {
        const activeIntegrations = {
          listActiveIntegrations: async () => {
            if (!control.listActiveIntegrations) {
              throw new Error('Active integration enumeration unavailable');
            }
            return control.listActiveIntegrations();
          },
        };
        return new ProactiveSalesNotificationService(
          config,
          activeIntegrations,
          identity,
          sessions,
          tasks,
          opportunities,
          dailyReports,
          teamReviews,
          planner,
          delivery,
          riskStates,
        );
      },
    },
  ],
})
class ProactiveSalesNotificationModule {}

export { ProactiveSalesNotificationModule };
