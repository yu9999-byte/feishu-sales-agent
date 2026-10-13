import type {
  DailySalesReportResponse,
  PlatformSessionResponse,
  ProactiveSalesNotificationRunResponse,
  ProactiveSalesNotificationRunSummary,
  TaskFulfillmentResponse,
  TeamReviewResponse,
  OpportunityDecisionResponse,
} from '@shared/api.interface';
import type { AgentRuntimeConfig } from '@server/config/agent.config';
import type { TenantIntegration } from '@server/modules/agent-core/agent.types';
import type { PlatformMember } from
  '@server/modules/identity-access/identity-access.types';
import type {
  ProactiveNotificationDeliveryInput,
  ProactiveNotificationDeliveryResult,
  ProactiveNotificationMessage,
} from './proactive-notification-delivery.service';
import type {
  ProactiveNotificationPlanScope,
  ProactiveRiskPlanResult,
} from './proactive-notification-planner.service';
import type { ProactiveRiskState } from
  './postgres-proactive-notification.store';
import {
  matchProactiveNotificationSchedules,
  type ProactiveNotificationScheduleKind,
  type ProactiveNotificationScheduleMatch,
} from './proactive-notification-schedule';

interface ProactiveNotificationControlReader {
  listActiveIntegrations(): Promise<TenantIntegration[]>;
}

interface ProactiveNotificationIdentityReader {
  listMembers(tenantId: string): Promise<PlatformMember[]>;
}

interface ProactiveNotificationSessionReader {
  getSessionByMembership(
    tenantId: string,
    memberId: string,
    occurredAt?: Date,
  ): Promise<PlatformSessionResponse>;
}

interface ProactiveTaskAnalyzer {
  analyze(input: {
    integration: TenantIntegration;
    actorOpenId: string;
    referenceDate: string;
    timezone: string;
    now?: Date;
    readOnly?: boolean;
  }): Promise<TaskFulfillmentResponse>;
}

interface ProactiveOpportunityAnalyzer {
  analyze(input: {
    integration: TenantIntegration;
    actorOpenId: string;
    referenceDate: string;
    timezone: string;
    now?: Date;
  }): Promise<OpportunityDecisionResponse>;
}

interface ProactiveDailyReportGenerator {
  generate(input: {
    integration: TenantIntegration;
    actorOpenId: string;
    reportDate: string;
    timezone: string;
    now?: Date;
  }): Promise<DailySalesReportResponse>;
}

interface ProactiveTeamReviewGenerator {
  generate(input: {
    integration: TenantIntegration;
    session: PlatformSessionResponse;
    reportDate: string;
    timezone: string;
    now?: Date;
  }): Promise<TeamReviewResponse>;
}

interface ProactiveNotificationPlanner {
  planTaskAction(
    scope: ProactiveNotificationPlanScope,
    report: TaskFulfillmentResponse,
  ): ProactiveNotificationMessage | null;
  planOpportunityRisks(
    scope: ProactiveNotificationPlanScope,
    report: OpportunityDecisionResponse,
    observedAt?: Date,
  ): Promise<ProactiveRiskPlanResult>;
  planDailyReport(
    scope: ProactiveNotificationPlanScope,
    report: DailySalesReportResponse,
  ): ProactiveNotificationMessage | null;
  planPersonalWeeklyReport(
    scope: ProactiveNotificationPlanScope,
    reports: DailySalesReportResponse[],
  ): ProactiveNotificationMessage | null;
  planTeamWeeklyReport(
    scope: ProactiveNotificationPlanScope,
    reports: TeamReviewResponse[],
  ): ProactiveNotificationMessage | null;
}

interface ProactiveNotificationDeliveryRunner {
  deliver(
    input: ProactiveNotificationDeliveryInput,
  ): Promise<ProactiveNotificationDeliveryResult>;
}

interface ProactiveRiskStateWriter {
  saveRiskState(input: ProactiveRiskState): Promise<void>;
}

interface ProactiveNotificationRunInput {
  now?: Date;
}

interface RunCounters extends ProactiveSalesNotificationRunSummary {
  warningCount: number;
}

const emptySummary = (): RunCounters => ({
  tenantCount: 0,
  memberCount: 0,
  plannedCount: 0,
  sentCount: 0,
  skippedCount: 0,
  failedCount: 0,
  warningCount: 0,
});

const shiftDate = (date: string, days: number): string => {
  const [year, month, day]: number[] = date.split('-').map(Number);
  const shifted: Date = new Date(Date.UTC(year, month - 1, day + days));
  return shifted.toISOString().slice(0, 10);
};

const workweekDates = (friday: string): string[] =>
  [-4, -3, -2, -1, 0].map(
    (offset: number): string => shiftDate(friday, offset),
  );

class ProactiveSalesNotificationService {
  constructor(
    private readonly config: AgentRuntimeConfig,
    private readonly control: ProactiveNotificationControlReader,
    private readonly identity: ProactiveNotificationIdentityReader,
    private readonly sessions: ProactiveNotificationSessionReader,
    private readonly tasks: ProactiveTaskAnalyzer,
    private readonly opportunities: ProactiveOpportunityAnalyzer,
    private readonly dailyReports: ProactiveDailyReportGenerator,
    private readonly teamReviews: ProactiveTeamReviewGenerator,
    private readonly planner: ProactiveNotificationPlanner,
    private readonly delivery: ProactiveNotificationDeliveryRunner,
    private readonly riskStates: ProactiveRiskStateWriter,
  ) {}

  async run(
    input: ProactiveNotificationRunInput = {},
  ): Promise<ProactiveSalesNotificationRunResponse> {
    const now: Date = input.now ?? new Date();
    const settings = this.config.proactiveSalesNotifications;
    if (settings?.enabled !== true) {
      return this.response('disabled', now, emptySummary(), []);
    }
    if (
      settings.enabledKinds.length === 0 ||
      !settings.allowedTenantId ||
      !settings.allowedMemberId ||
      !settings.allowedRecipientOpenId
    ) {
      return this.response('blocked', now, emptySummary(), [
        'rollout_scope_not_configured',
      ]);
    }
    let integrations: TenantIntegration[];
    try {
      integrations = await this.control.listActiveIntegrations();
    } catch (_error: unknown) {
      return this.response('blocked', now, emptySummary(), [
        'active_integrations_unavailable',
      ]);
    }
    const counters: RunCounters = emptySummary();
    const warnings: Set<string> = new Set();
    const allowedIntegrations: TenantIntegration[] = integrations.filter(
      (integration: TenantIntegration): boolean =>
        integration.tenantId === settings.allowedTenantId,
    );
    for (const integration of allowedIntegrations) {
      const tenantResult: boolean = await this.processTenant(
        integration,
        now,
        counters,
        warnings,
      );
      if (tenantResult) counters.tenantCount += 1;
    }
    counters.warningCount = warnings.size;
    const status: ProactiveSalesNotificationRunResponse['status'] =
      settings.deliveryEnabled !== true
        ? 'plan_only'
        : counters.failedCount > 0 || warnings.size > 0
          ? 'partial'
          : 'completed';
    return this.response(status, now, counters, [...warnings].sort());
  }

  private async processTenant(
    integration: TenantIntegration,
    now: Date,
    counters: RunCounters,
    warnings: Set<string>,
  ): Promise<boolean> {
    let members: PlatformMember[];
    try {
      members = await this.identity.listMembers(integration.tenantId);
    } catch (_error: unknown) {
      warnings.add('tenant_members_unavailable');
      return true;
    }
    const activeMembers: PlatformMember[] = members.filter(
      (member: PlatformMember): boolean =>
        member.status === 'active' &&
        member.tenantId === integration.tenantId &&
        member.id === this.config.proactiveSalesNotifications?.allowedMemberId &&
        member.feishuOpenId ===
          this.config.proactiveSalesNotifications?.allowedRecipientOpenId,
    );
    let matchedSchedule = false;
    for (const member of activeMembers) {
      let session: PlatformSessionResponse;
      try {
        session = await this.sessions.getSessionByMembership(
          integration.tenantId,
          member.id,
          now,
        );
      } catch (_error: unknown) {
        warnings.add('member_session_unavailable');
        continue;
      }
      const schedule: ProactiveNotificationScheduleMatch =
        matchProactiveNotificationSchedules(now, session.tenant.timezone);
      if (schedule.warning || schedule.localDate === null) {
        warnings.add('invalid_timezone');
        continue;
      }
      const enabledKinds: Set<ProactiveNotificationScheduleKind> = new Set(
        this.config.proactiveSalesNotifications?.enabledKinds ?? [],
      );
      const scheduledKinds: ProactiveNotificationScheduleKind[] =
        schedule.kinds.filter(
          (scheduledKind: ProactiveNotificationScheduleKind): boolean =>
            enabledKinds.has(scheduledKind),
        );
      if (scheduledKinds.length === 0) continue;
      matchedSchedule = true;
      counters.memberCount += 1;
      const scope: ProactiveNotificationPlanScope = {
        tenantId: integration.tenantId,
        recipientMemberId: member.id,
        recipientOpenId: member.feishuOpenId,
        localDate: schedule.localDate,
        timezone: session.tenant.timezone,
        webPublicUrl: this.config.proactiveSalesNotifications?.webPublicUrl,
      };
      for (const kind of scheduledKinds) {
        await this.processKind(
          kind,
          integration,
          session,
          scope,
          now,
          counters,
          warnings,
        );
      }
    }
    return matchedSchedule;
  }

  private async processKind(
    kind: ProactiveNotificationScheduleKind,
    integration: TenantIntegration,
    session: PlatformSessionResponse,
    scope: ProactiveNotificationPlanScope,
    now: Date,
    counters: RunCounters,
    warnings: Set<string>,
  ): Promise<void> {
    try {
      if (kind === 'task_action') {
        await this.processTask(integration, session, scope, now, counters);
      } else if (kind === 'opportunity_risk') {
        await this.processRisks(integration, session, scope, now, counters);
      } else if (kind === 'daily_report') {
        await this.processDaily(integration, session, scope, now, counters);
      } else if (kind === 'weekly_personal') {
        await this.processPersonalWeekly(
          integration, session, scope, now, counters,
        );
      } else {
        await this.processTeamWeekly(
          integration, session, scope, now, counters,
        );
      }
    } catch (_error: unknown) {
      warnings.add(`${kind}_generation_failed`);
    }
  }

  private async processTask(
    integration: TenantIntegration,
    session: PlatformSessionResponse,
    scope: ProactiveNotificationPlanScope,
    now: Date,
    counters: RunCounters,
  ): Promise<void> {
    if (
      !session.permissions.includes('review:read-personal') ||
      !session.permissions.includes('task:read')
    ) return;
    const report: TaskFulfillmentResponse = await this.tasks.analyze({
      integration,
      actorOpenId: session.member.feishuOpenId,
      referenceDate: scope.localDate,
      timezone: scope.timezone,
      now,
      readOnly: true,
    });
    await this.dispatch(
      this.planner.planTaskAction(scope, report),
      now,
      counters,
    );
  }

  private async processRisks(
    integration: TenantIntegration,
    session: PlatformSessionResponse,
    scope: ProactiveNotificationPlanScope,
    now: Date,
    counters: RunCounters,
  ): Promise<void> {
    if (
      !session.permissions.includes('review:read-personal') ||
      !session.permissions.includes('opportunity:read')
    ) return;
    const report: OpportunityDecisionResponse =
      await this.opportunities.analyze({
        integration,
        actorOpenId: session.member.feishuOpenId,
        referenceDate: scope.localDate,
        timezone: scope.timezone,
        now,
      });
    const plan: ProactiveRiskPlanResult =
      await this.planner.planOpportunityRisks(scope, report, now);
    const results: Map<string, ProactiveNotificationDeliveryResult | null> =
      new Map();
    for (const message of plan.messages) {
      results.set(
        message.subjectKey,
        await this.dispatch(message, now, counters),
      );
    }
    if (this.config.proactiveSalesNotifications?.deliveryEnabled !== true) {
      return;
    }
    for (const observation of plan.observations) {
      const result: ProactiveNotificationDeliveryResult | null | undefined =
        results.get(observation.opportunityRecordId);
      const mayPersist: boolean = result === undefined ||
        result?.status === 'sent' ||
        (result?.status === 'skipped' && result.reason === 'already_sent');
      if (mayPersist) await this.riskStates.saveRiskState(observation);
    }
  }

  private async processDaily(
    integration: TenantIntegration,
    session: PlatformSessionResponse,
    scope: ProactiveNotificationPlanScope,
    now: Date,
    counters: RunCounters,
  ): Promise<void> {
    if (!session.permissions.includes('review:read-personal')) return;
    const report: DailySalesReportResponse = await this.dailyReports.generate({
      integration,
      actorOpenId: session.member.feishuOpenId,
      reportDate: scope.localDate,
      timezone: scope.timezone,
      now,
    });
    await this.dispatch(
      this.planner.planDailyReport(scope, report),
      now,
      counters,
    );
  }

  private async processPersonalWeekly(
    integration: TenantIntegration,
    session: PlatformSessionResponse,
    scope: ProactiveNotificationPlanScope,
    now: Date,
    counters: RunCounters,
  ): Promise<void> {
    if (!session.permissions.includes('review:read-personal')) return;
    const reports: DailySalesReportResponse[] = [];
    for (const reportDate of workweekDates(scope.localDate)) {
      reports.push(await this.dailyReports.generate({
        integration,
        actorOpenId: session.member.feishuOpenId,
        reportDate,
        timezone: scope.timezone,
        now,
      }));
    }
    await this.dispatch(
      this.planner.planPersonalWeeklyReport(scope, reports),
      now,
      counters,
    );
  }

  private async processTeamWeekly(
    integration: TenantIntegration,
    session: PlatformSessionResponse,
    scope: ProactiveNotificationPlanScope,
    now: Date,
    counters: RunCounters,
  ): Promise<void> {
    if (!session.permissions.includes('review:read-team')) return;
    const reports: TeamReviewResponse[] = [];
    for (const reportDate of workweekDates(scope.localDate)) {
      reports.push(await this.teamReviews.generate({
        integration,
        session,
        reportDate,
        timezone: scope.timezone,
        now,
      }));
    }
    await this.dispatch(
      this.planner.planTeamWeeklyReport(scope, reports),
      now,
      counters,
    );
  }

  private async dispatch(
    message: ProactiveNotificationMessage | null,
    now: Date,
    counters: RunCounters,
  ): Promise<ProactiveNotificationDeliveryResult | null> {
    if (message === null) return null;
    counters.plannedCount += 1;
    const deliveryEnabled: boolean =
      this.config.proactiveSalesNotifications?.deliveryEnabled === true;
    if (!deliveryEnabled) return null;
    let result: ProactiveNotificationDeliveryResult;
    try {
      result = await this.delivery.deliver({ enabled: true, message, now });
    } catch (error: unknown) {
      counters.failedCount += 1;
      throw error;
    }
    if (result.status === 'sent') counters.sentCount += 1;
    else if (result.status === 'skipped') counters.skippedCount += 1;
    else counters.failedCount += 1;
    return result;
  }

  private response(
    status: ProactiveSalesNotificationRunResponse['status'],
    now: Date,
    counters: RunCounters,
    warnings: string[],
  ): ProactiveSalesNotificationRunResponse {
    return {
      mode: 'scheduler-run',
      status,
      generatedAt: now.toISOString(),
      summary: {
        tenantCount: counters.tenantCount,
        memberCount: counters.memberCount,
        plannedCount: counters.plannedCount,
        sentCount: counters.sentCount,
        skippedCount: counters.skippedCount,
        failedCount: counters.failedCount,
      },
      warnings,
    };
  }
}

export { ProactiveSalesNotificationService };
export type {
  ProactiveDailyReportGenerator,
  ProactiveNotificationControlReader,
  ProactiveNotificationDeliveryRunner,
  ProactiveNotificationIdentityReader,
  ProactiveNotificationPlanner,
  ProactiveNotificationRunInput,
  ProactiveNotificationSessionReader,
  ProactiveOpportunityAnalyzer,
  ProactiveRiskStateWriter,
  ProactiveTaskAnalyzer,
  ProactiveTeamReviewGenerator,
};
