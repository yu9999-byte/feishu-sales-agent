import { createHash } from 'node:crypto';
import { buildTodayActions } from './today-action-planner';
import { todayActionVersion } from './today-action-version';

import type {
  DailySalesReportResponse,
  OpportunityDecisionHealth,
  OpportunityDecisionItem,
  OpportunityDecisionResponse,
  TaskFulfillmentItem,
  TaskFulfillmentResponse,
  TeamReviewAttention,
  TeamReviewResponse,
} from '@shared/api.interface';
import type {
  ProactiveNotificationMessage,
  ProactiveNotificationSection,
} from './proactive-notification-delivery.service';
import type {
  ProactiveRiskState,
  ProactiveRiskStateStore,
} from './postgres-proactive-notification.store';

interface ProactiveNotificationPlanScope {
  tenantId: string;
  recipientMemberId: string;
  recipientOpenId: string;
  localDate: string;
  timezone: string;
  webPublicUrl?: string;
  now?: Date;
}

interface ProactiveRiskPlanResult {
  messages: ProactiveNotificationMessage[];
  observations: ProactiveRiskState[];
}

const HEALTH_RANK: Record<OpportunityDecisionHealth, number> = {
  on_track: 0,
  needs_attention: 1,
  at_risk: 2,
  critical: 3,
};

const compactLines = (values: string[]): string[] => {
  const normalized: string[] = values
    .map((value: string): string => value.trim().replace(/\s+/gu, ' '))
    .filter((value: string): boolean => value.length > 0);
  if (normalized.length <= 5) return normalized;
  return [...normalized.slice(0, 4), `另有 ${normalized.length - 4} 项`];
};

const pageUrl = (
  scope: ProactiveNotificationPlanScope,
  path: string,
): string | undefined => scope.webPublicUrl
  ? `${scope.webPublicUrl.replace(/\/$/u, '')}${path}`
  : undefined;

class ProactiveNotificationPlannerService {
  constructor(
    private readonly riskStates?: ProactiveRiskStateStore,
  ) {}

  planTaskAction(
    scope: ProactiveNotificationPlanScope,
    report: TaskFulfillmentResponse,
  ): ProactiveNotificationMessage | null {
    if (report.status === 'unavailable') return null;
    const overdue: TaskFulfillmentItem[] = report.items.filter(
      (item: TaskFulfillmentItem): boolean =>
        item.daysUntilDue !== null && item.daysUntilDue < 0,
    );
    const dueToday: TaskFulfillmentItem[] = report.items.filter(
      (item: TaskFulfillmentItem): boolean => item.daysUntilDue === 0,
    );
    const dueTomorrow: TaskFulfillmentItem[] = report.items.filter(
      (item: TaskFulfillmentItem): boolean => item.daysUntilDue === 1,
    );
    const sections: ProactiveNotificationSection[] = [
      this.taskSection('已逾期', overdue),
      this.taskSection('今日到期', dueToday),
      this.taskSection('明日到期', dueTomorrow),
    ].filter((section: ProactiveNotificationSection): boolean =>
      section.lines.length > 0);
    if (sections.length === 0) return null;
    const count: number = overdue.length + dueToday.length +
      dueTomorrow.length;
    return this.message(scope, {
      kind: 'task_action',
      notificationKey: scope.localDate,
      subjectKey: 'task-digest',
      title: '今日任务行动提醒',
      subtitle: `${count} 个任务需要关注 · ${scope.localDate}`,
      sections,
      actionLabel: '打开今日行动中心',
      actionUrl: pageUrl(scope, '/today-actions'),
      shortcuts: buildTodayActions({ referenceDate: scope.localDate, timezone: scope.timezone,
        tasks: report.items, opportunities: [], followups: [] }).slice(0, 4).flatMap((item) => [{
        label: `${item.title.slice(0, 65)} · 标记已处理`,
        value: { action: 'today_action' as const, operation: 'resolve' as const,
          recipientOpenId: scope.recipientOpenId, itemId: item.id,
          itemVersion: todayActionVersion(item), expectedRevision: 0,
          idempotencyKey: `card:${scope.localDate}:${item.id}:${todayActionVersion(item)}:resolve`,
        },
      }, ...(scope.now ? [{
        label: `${item.title.slice(0, 45)} · ${new Intl.DateTimeFormat('zh-CN', {
          timeZone: scope.timezone, month: '2-digit', day: '2-digit',
          hour: '2-digit', minute: '2-digit', hour12: false,
        }).format(new Date(scope.now.getTime() + 3600000))} 提醒`,
        value: { action: 'today_action' as const, operation: 'snooze' as const,
          recipientOpenId: scope.recipientOpenId, itemId: item.id,
          itemVersion: todayActionVersion(item), expectedRevision: 0,
          idempotencyKey: `card:${scope.localDate}:${item.id}:${todayActionVersion(item)}:snooze`,
          remindAt: new Date(scope.now.getTime() + 3600000).toISOString(),
        },
      }] : [])]),
    });
  }

  async planOpportunityRisks(
    scope: ProactiveNotificationPlanScope,
    report: OpportunityDecisionResponse,
    observedAt: Date = new Date(report.generatedAt),
  ): Promise<ProactiveRiskPlanResult> {
    if (report.status !== 'ready' || !this.riskStates) {
      return { messages: [], observations: [] };
    }
    const messages: ProactiveNotificationMessage[] = [];
    const observations: ProactiveRiskState[] = [];
    for (const opportunity of report.priorities) {
      const rank: number = HEALTH_RANK[opportunity.health];
      const fingerprint: string = this.fingerprint({
        health: opportunity.health,
        priorityScore: opportunity.priorityScore,
        risks: opportunity.risks.map((risk) => ({
          code: risk.code,
          severity: risk.severity,
          detail: risk.detail,
        })),
        recommendation: opportunity.recommendation?.action ?? null,
      });
      const observation: ProactiveRiskState = {
        tenantId: scope.tenantId,
        recipientMemberId: scope.recipientMemberId,
        opportunityRecordId: opportunity.recordId,
        severityRank: rank,
        payloadFingerprint: fingerprint,
        observedAt,
      };
      observations.push(observation);
      const previous: ProactiveRiskState | null =
        await this.riskStates.getRiskState({
          tenantId: scope.tenantId,
          recipientMemberId: scope.recipientMemberId,
          opportunityRecordId: opportunity.recordId,
        });
      if (rank < 2 || (previous !== null && rank <= previous.severityRank)) {
        continue;
      }
      messages.push(this.riskMessage(scope, opportunity, fingerprint));
    }
    return { messages, observations };
  }

  planDailyReport(
    scope: ProactiveNotificationPlanScope,
    report: DailySalesReportResponse,
  ): ProactiveNotificationMessage | null {
    if (report.status === 'unavailable') return null;
    const hasActivity: boolean =
      report.metrics.followupCount > 0 ||
      report.metrics.opportunityCount > 0 ||
      report.metrics.openTaskCount > 0 ||
      report.metrics.overdueTaskCount > 0 ||
      report.highlights.length > 0 ||
      report.nextActions.length > 0;
    const sections: ProactiveNotificationSection[] = [{
      title: '今日概览',
      lines: hasActivity
        ? [
            `跟进 ${report.metrics.followupCount} 条`,
            `涉及商机 ${report.metrics.opportunityCount} 个`,
            `未完成任务 ${report.metrics.openTaskCount} 个`,
            `逾期任务 ${report.metrics.overdueTaskCount} 个`,
          ]
        : ['今日无新增'],
    }];
    if (report.highlights.length > 0) {
      sections.push({
        title: '关键变化',
        lines: compactLines(report.highlights),
      });
    }
    if (report.nextActions.length > 0) {
      sections.push({
        title: '下一步',
        lines: compactLines(report.nextActions),
      });
    }
    if (hasActivity && report.warnings.length > 0) {
      sections.push({
        title: '数据覆盖说明',
        lines: compactLines(report.warnings),
      });
    }
    return this.message(scope, {
      kind: 'daily_report',
      notificationKey: report.reportDate,
      subjectKey: report.reportDate,
      title: '销售日报',
      subtitle: `${report.reportDate} · 数据截至 17:00`,
      sections,
      actionLabel: '查看完整日报',
      actionUrl: pageUrl(scope, `/daily-report?date=${report.reportDate}`),
    });
  }

  planPersonalWeeklyReport(
    scope: ProactiveNotificationPlanScope,
    reports: DailySalesReportResponse[],
  ): ProactiveNotificationMessage | null {
    const available: DailySalesReportResponse[] = reports.filter(
      (report: DailySalesReportResponse): boolean =>
        report.status !== 'unavailable',
    );
    if (available.length === 0) return null;
    const followups: number = available.reduce(
      (sum: number, report: DailySalesReportResponse): number =>
        sum + report.metrics.followupCount,
      0,
    );
    const opportunities: number = available.reduce(
      (sum: number, report: DailySalesReportResponse): number =>
        sum + report.metrics.opportunityCount,
      0,
    );
    const overdueMax: number = Math.max(
      ...available.map(
        (report: DailySalesReportResponse): number =>
          report.metrics.overdueTaskCount,
      ),
    );
    const nextActions: string[] = compactLines(
      available.flatMap(
        (report: DailySalesReportResponse): string[] => report.nextActions,
      ),
    );
    const startDate: string = reports[0]?.reportDate ?? scope.localDate;
    const sections: ProactiveNotificationSection[] = [{
      title: '本周概览',
      lines: [
        `跟进 ${followups} 条`,
        `涉及商机 ${opportunities} 次`,
        `本周最高逾期任务数 ${overdueMax} 个`,
        `已覆盖 ${available.length}/5 个工作日`,
      ],
    }];
    if (nextActions.length > 0) {
      sections.push({ title: '下周重点', lines: nextActions });
    }
    return this.message(scope, {
      kind: 'weekly_personal',
      notificationKey: `${startDate}:${scope.localDate}`,
      subjectKey: startDate,
      title: '个人销售周报',
      subtitle: `${startDate} 至 ${scope.localDate}`,
      sections,
      actionLabel: '查看日报与明细',
      actionUrl: pageUrl(scope, `/daily-report?date=${scope.localDate}`),
    });
  }

  planTeamWeeklyReport(
    scope: ProactiveNotificationPlanScope,
    reports: TeamReviewResponse[],
  ): ProactiveNotificationMessage | null {
    const available: TeamReviewResponse[] = reports.filter(
      (report: TeamReviewResponse): boolean =>
        report.status !== 'unavailable',
    );
    if (available.length === 0) return null;
    const latest: TeamReviewResponse = available[available.length - 1];
    const followups: number = available.reduce(
      (sum: number, report: TeamReviewResponse): number =>
        sum + report.metrics.followupCount,
      0,
    );
    const attentions: string[] = compactLines(
      latest.attentions.map(
        (attention: TeamReviewAttention): string =>
          `${attention.displayName}：${attention.reasons[0] ?? '需要关注'}`,
      ),
    );
    const startDate: string = reports[0]?.reviewDate ?? scope.localDate;
    const sections: ProactiveNotificationSection[] = [{
      title: '团队本周概览',
      lines: [
        `团队成员 ${latest.metrics.memberCount} 人`,
        `跟进 ${followups} 条`,
        `当前逾期任务 ${latest.metrics.overdueTaskCount} 个`,
        `需关注成员 ${latest.metrics.attentionMemberCount} 人`,
        `已覆盖 ${available.length}/5 个工作日`,
      ],
    }];
    if (attentions.length > 0) {
      sections.push({ title: '主管关注', lines: attentions });
    }
    return this.message(scope, {
      kind: 'weekly_team',
      notificationKey: `${startDate}:${scope.localDate}`,
      subjectKey: startDate,
      title: '团队销售周报',
      subtitle: `${startDate} 至 ${scope.localDate}`,
      sections,
      actionLabel: '查看团队 Review',
      actionUrl: pageUrl(scope, '/reviews/team'),
    });
  }

  private taskSection(
    label: string,
    items: TaskFulfillmentItem[],
  ): ProactiveNotificationSection {
    return {
      title: `${label} · ${items.length}`,
      lines: compactLines(items.map(
        (item: TaskFulfillmentItem): string => item.title,
      )),
    };
  }

  private riskMessage(
    scope: ProactiveNotificationPlanScope,
    opportunity: OpportunityDecisionItem,
    fingerprint: string,
  ): ProactiveNotificationMessage {
    const riskLines: string[] = compactLines(
      opportunity.risks.map((risk): string => risk.title),
    );
    const action: string = opportunity.recommendation?.action ??
      '请核对项目状态并明确下一步';
    return this.message(scope, {
      kind: 'opportunity_risk',
      notificationKey: `${opportunity.recordId}:${fingerprint}`,
      subjectKey: opportunity.recordId,
      title: opportunity.health === 'critical'
        ? '商机高风险提醒'
        : '商机风险提醒',
      subtitle: `${opportunity.name} · ${scope.localDate}`,
      sections: [
        { title: '风险信号', lines: riskLines },
        { title: '建议动作', lines: [action] },
      ],
      actionLabel: '查看商机决策',
      actionUrl: pageUrl(scope, '/opportunities'),
    });
  }

  private message(
    scope: ProactiveNotificationPlanScope,
    input: Omit<ProactiveNotificationMessage,
      'tenantId' | 'recipientMemberId' | 'recipientOpenId' |
      'payloadFingerprint'>,
  ): ProactiveNotificationMessage {
    return {
      tenantId: scope.tenantId,
      recipientMemberId: scope.recipientMemberId,
      recipientOpenId: scope.recipientOpenId,
      ...input,
      payloadFingerprint: this.fingerprint({
        kind: input.kind,
        subjectKey: input.subjectKey,
        title: input.title,
        subtitle: input.subtitle,
        sections: input.sections,
        shortcuts: input.shortcuts,
      }),
    };
  }

  private fingerprint(value: unknown): string {
    return createHash('sha256')
      .update(JSON.stringify(value))
      .digest('hex');
  }
}

export { ProactiveNotificationPlannerService };
export type {
  ProactiveNotificationPlanScope,
  ProactiveRiskPlanResult,
};
