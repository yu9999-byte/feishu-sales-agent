import { Inject, Injectable, Logger } from '@nestjs/common';

import type {
  DailySalesReportSource,
  OpportunityDecisionCoverage,
  OpportunityDecisionCustomer,
  OpportunityDecisionEvidence,
  OpportunityDecisionGap,
  OpportunityDecisionGapCode,
  OpportunityDecisionGlobalTaskAlert,
  OpportunityDecisionHealth,
  OpportunityDecisionItem,
  OpportunityDecisionRecommendation,
  OpportunityDecisionResponse,
  OpportunityDecisionRisk,
  OpportunityDecisionRiskCode,
  OpportunityDecisionSummary,
  TaskFulfillmentResponse,
  TaskPromiseFulfillmentItem,
} from '@shared/api.interface';
import {
  SALES_RECORDS_GATEWAY,
  type SalesRecordsGateway,
} from '@server/modules/agent-core/agent.ports';
import type {
  OpportunityPortfolioCustomerRecord,
  OpportunityPortfolioFollowupRecord,
  OpportunityPortfolioOpportunityRecord,
  OpportunityPortfolioResult,
  TenantIntegration,
} from '@server/modules/agent-core/agent.types';
import { TaskFulfillmentService } from './task-fulfillment.service';

interface OpportunityDecisionInput {
  integration: TenantIntegration;
  actorOpenId: string;
  referenceDate: string;
  timezone: string;
  now?: Date;
  portfolio?: OpportunityPortfolioResult;
}

interface DecisionDraft {
  item: OpportunityDecisionItem;
  amount: number;
}

const DAY_MS = 86_400_000;
const STALE_FOLLOWUP_DAYS = 14;
const CRITICAL_STALE_FOLLOWUP_DAYS = 30;
const HEALTH_PRIORITY: Record<OpportunityDecisionHealth, number> = {
  critical: 4,
  at_risk: 3,
  needs_attention: 2,
  on_track: 1,
};

const validTimestamp = (value: string | null): number | null => {
  if (value === null) return null;
  const timestamp: number = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : null;
};

const dateOrdinal = (value: string): number => {
  const [year, month, day] = value.split('-').map(Number);
  return Math.floor(Date.UTC(year, month - 1, day) / DAY_MS);
};

const localDateKey = (value: Date, timezone: string): string => {
  const parts: Intl.DateTimeFormatPart[] = new Intl.DateTimeFormat(
    'en-CA',
    {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    },
  ).formatToParts(value);
  const partValue = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find(
      (part: Intl.DateTimeFormatPart): boolean => part.type === type,
    )?.value ?? '';
  return [partValue('year'), partValue('month'), partValue('day')].join('-');
};

const normalize = (value: string | null): string =>
  value?.normalize('NFKC').toLocaleLowerCase().replace(/\s+/gu, '') ?? '';

const sourceOf = (
  record: {
    recordId: string;
    recordUrl: string | null;
    sourceVersion: string | null;
  },
): DailySalesReportSource => ({
  recordId: record.recordId,
  recordUrl: record.recordUrl,
  sourceVersion: record.sourceVersion,
});

@Injectable()
class OpportunityDecisionService {
  private readonly logger: Logger = new Logger(OpportunityDecisionService.name);

  constructor(
    @Inject(SALES_RECORDS_GATEWAY)
    private readonly records: SalesRecordsGateway,
    private readonly taskFulfillment: TaskFulfillmentService,
  ) {}

  async analyze(
    input: OpportunityDecisionInput,
  ): Promise<OpportunityDecisionResponse> {
    const now: Date = input.now ?? new Date();
    const empty: OpportunityDecisionResponse = this.emptyResponse(input, now);
    if (input.integration.status !== 'active' || !input.actorOpenId.trim()) {
      return {
        ...empty,
        status: 'unavailable',
        warnings: ['当前销售身份或销售数据连接不可用'],
      };
    }
    if (!this.validDateAndTimezone(input.referenceDate, input.timezone)) {
      return {
        ...empty,
        status: 'unavailable',
        warnings: ['检查日期或销售时区无效'],
      };
    }
    if (!input.portfolio && !this.records.readOpportunityPortfolio) {
      return {
        ...empty,
        status: 'unavailable',
        warnings: ['客户与商机组合数据源未配置'],
      };
    }

    let portfolio: OpportunityPortfolioResult;
    if (input.portfolio) {
      portfolio = input.portfolio;
    } else {
      try {
        portfolio = await this.records.readOpportunityPortfolio!(
          input.integration,
          input.actorOpenId,
        );
      } catch (error: unknown) {
        this.logger.warn(
          `Opportunity portfolio read failed: ${error instanceof Error
            ? error.message
            : String(error)}`,
        );
        return {
          ...empty,
          status: 'unavailable',
          warnings: ['客户与商机数据源暂时不可用'],
        };
      }
    }

    const taskReport: TaskFulfillmentResponse =
      await this.taskFulfillment.analyze({
        integration: input.integration,
        actorOpenId: input.actorOpenId,
        referenceDate: input.referenceDate,
        timezone: input.timezone,
        now,
        readOnly: true,
      });
    const customerById: Map<string, OpportunityPortfolioCustomerRecord> =
      new Map(
        portfolio.customers.map(
          (
            customer: OpportunityPortfolioCustomerRecord,
          ): [string, OpportunityPortfolioCustomerRecord] => [
            customer.recordId,
            customer,
          ],
        ),
      );
    const active: OpportunityPortfolioOpportunityRecord[] =
      portfolio.opportunities.filter(
        (opportunity: OpportunityPortfolioOpportunityRecord): boolean =>
          opportunity.status === 'active' || opportunity.status === 'unknown',
      );
    const promisesByOpportunity: Map<string, TaskPromiseFulfillmentItem[]> =
      this.groupPromises(taskReport.promises);
    const drafts: DecisionDraft[] = active.map(
      (opportunity: OpportunityPortfolioOpportunityRecord): DecisionDraft =>
        this.assessOpportunity(
          opportunity,
          customerById,
          portfolio.followups,
          promisesByOpportunity.get(normalize(opportunity.name)) ?? [],
          input,
          now,
        ),
    );
    drafts.sort((left: DecisionDraft, right: DecisionDraft): number => {
      const healthDifference: number =
        HEALTH_PRIORITY[right.item.health] - HEALTH_PRIORITY[left.item.health];
      if (healthDifference !== 0) return healthDifference;
      const scoreDifference: number =
        right.item.priorityScore - left.item.priorityScore;
      if (scoreDifference !== 0) return scoreDifference;
      const amountDifference: number = right.amount - left.amount;
      if (amountDifference !== 0) return amountDifference;
      return left.item.name.localeCompare(right.item.name, 'zh-CN');
    });
    const priorities: OpportunityDecisionItem[] = drafts.map(
      (draft: DecisionDraft, index: number): OpportunityDecisionItem => ({
        ...draft.item,
        rank: index + 1,
      }),
    );
    const customers: OpportunityDecisionCustomer[] = this.customers(
      portfolio.customers,
      priorities,
    );
    const globalTaskAlerts: OpportunityDecisionGlobalTaskAlert[] =
      this.globalTaskAlerts(taskReport, priorities);
    const coverage: OpportunityDecisionCoverage = this.coverage(
      portfolio.warnings,
      taskReport,
    );
    const warnings: string[] = [
      ...portfolio.warnings.map(this.portfolioWarning),
      ...taskReport.warnings,
    ];
    const summary: OpportunityDecisionSummary = this.summary(
      priorities,
      portfolio.opportunities.length - active.length,
    );
    const status: OpportunityDecisionResponse['status'] =
      priorities.length === 0
        ? warnings.length > 0 && coverage.opportunities === 'unavailable'
          ? 'unavailable'
          : 'empty'
        : warnings.length > 0 || taskReport.status === 'partial' ||
            taskReport.status === 'unavailable'
          ? 'partial'
          : 'ready';
    return {
      referenceDate: input.referenceDate,
      timezone: input.timezone,
      status,
      generatedAt: now.toISOString(),
      summary,
      customers,
      priorities,
      globalTaskAlerts,
      coverage,
      warnings: Array.from(new Set(warnings)),
    };
  }

  formatConversationReply(
    report: OpportunityDecisionResponse,
    query: string,
  ): string {
    if (report.status === 'unavailable') {
      return '我现在无法可靠读取本人客户与商机组合数据，未生成推进结论。' +
        `原因：${report.warnings.join('；') || '数据源不可用'}。`;
    }
    if (report.priorities.length === 0) {
      return '当前没有可供判断的本人进行中商机。已赢单、已丢单和已关闭商机不会进入推进排序。';
    }
    const scoped: OpportunityDecisionItem[] = this.matchQuery(
      report.priorities,
      query,
    );
    const selected: OpportunityDecisionItem[] =
      (scoped.length > 0 ? scoped : report.priorities).slice(0, 3);
    const lead: OpportunityDecisionItem = selected[0];
    const reasonParts: string[] = [
      ...lead.risks.slice(0, 2).map(
        (risk: OpportunityDecisionRisk): string => risk.title,
      ),
      ...lead.gaps.slice(0, 2).map(
        (gap: OpportunityDecisionGap): string => gap.title,
      ),
    ];
    const lines: string[] = [
      `现在最该推进：${lead.name}${lead.customerName
        ? `（${lead.customerName}）`
        : ''}。`,
      `原因：${reasonParts.join('；') || '当前证据未显示明显风险或缺口'}。`,
      `下一步：${lead.recommendation?.action ??
        '按已有计划推进，并在出现新事实时更新商机。'}`,
    ];
    if (lead.lastFollowupAt || lead.lastFollowupSummary) {
      lines.push(
        `最近依据：${lead.lastFollowupSummary ?? '已有跟进记录'}${
          lead.lastFollowupAt ? `（${lead.lastFollowupAt}）` : ''}。`,
      );
    }
    if (selected.length > 1) {
      lines.push(
        `随后关注：${selected.slice(1).map(
          (item: OpportunityDecisionItem): string =>
            `${item.rank}. ${item.name}（${item.risks[0]?.title ??
              item.gaps[0]?.title ?? '按计划推进'}）`,
        ).join('；')}。`,
      );
    }
    if (report.globalTaskAlerts.length > 0) {
      lines.push(
        `另外：${report.globalTaskAlerts.map(
          (alert: OpportunityDecisionGlobalTaskAlert): string => alert.detail,
        ).join('；')}。`,
      );
    }
    lines.push(
      '以上仅基于本人可见的业务事实；普通任务未通过标题猜测绑定商机，建议尚未执行。',
    );
    return lines.join('\n');
  }

  private assessOpportunity(
    opportunity: OpportunityPortfolioOpportunityRecord,
    customerById: Map<string, OpportunityPortfolioCustomerRecord>,
    followups: OpportunityPortfolioFollowupRecord[],
    promises: TaskPromiseFulfillmentItem[],
    input: OpportunityDecisionInput,
    now: Date,
  ): DecisionDraft {
    const customer: OpportunityPortfolioCustomerRecord | null =
      opportunity.customerRecordId === null
        ? null
        : customerById.get(opportunity.customerRecordId) ?? null;
    const relatedFollowups: OpportunityPortfolioFollowupRecord[] = followups
      .filter(
        (followup: OpportunityPortfolioFollowupRecord): boolean =>
          followup.opportunityRecordId === opportunity.recordId,
      );
    const latestFollowup: OpportunityPortfolioFollowupRecord | null =
      this.latestFollowup(relatedFollowups);
    const evidence: OpportunityDecisionEvidence[] = [
      {
        id: `opportunity:${opportunity.recordId}`,
        kind: 'opportunity',
        label: '商机当前记录',
        value: opportunity.progress ?? opportunity.name,
        occurredAt: opportunity.sourceVersion,
        source: sourceOf(opportunity),
      },
    ];
    if (customer) {
      evidence.push({
        id: `customer:${customer.recordId}`,
        kind: 'customer',
        label: '关联客户',
        value: customer.name,
        occurredAt: customer.sourceVersion,
        source: sourceOf(customer),
      });
    }
    if (latestFollowup) {
      evidence.push({
        id: `followup:${latestFollowup.recordId}`,
        kind: 'followup',
        label: '最近一次可信跟进',
        value: latestFollowup.summary,
        occurredAt: latestFollowup.communicationAt,
        source: sourceOf(latestFollowup),
      });
    }
    promises.forEach((promise: TaskPromiseFulfillmentItem): void => {
      evidence.push({
        id: `task-promise:${promise.pendingActionId}`,
        kind: 'task_promise',
        label: '已确认的下一步任务',
        value: promise.nextAction,
        occurredAt: promise.confirmedAt,
        source: null,
      });
    });

    const risks: OpportunityDecisionRisk[] = this.risks(
      opportunity,
      relatedFollowups,
      latestFollowup,
      promises,
      input,
      now,
    );
    const gaps: OpportunityDecisionGap[] = this.gaps(opportunity, customer);
    const priorityScore: number = this.score(risks, gaps);
    const health: OpportunityDecisionHealth = this.health(
      risks,
      priorityScore,
    );
    const recommendation: OpportunityDecisionRecommendation | null =
      this.recommend(opportunity, risks, gaps);
    return {
      amount: opportunity.expectedAmount ?? 0,
      item: {
        rank: 0,
        recordId: opportunity.recordId,
        recordUrl: opportunity.recordUrl,
        name: opportunity.name,
        customerRecordId: opportunity.customerRecordId,
        customerName: customer?.name ?? null,
        lifecycleStatus: opportunity.status,
        expectedAmount: opportunity.expectedAmount,
        progress: opportunity.progress,
        lastFollowupAt: latestFollowup?.communicationAt ?? null,
        lastFollowupSummary: latestFollowup?.summary ?? null,
        nextAction: opportunity.nextAction,
        dueAt: opportunity.dueAt,
        health,
        priorityScore,
        risks,
        gaps,
        recommendation,
        taskPromises: promises.map(
          (promise: TaskPromiseFulfillmentItem) => ({
            pendingActionId: promise.pendingActionId,
            taskGuid: promise.taskGuid,
            title: promise.nextAction,
            status: promise.status,
            dueAt: promise.taskDueAt ?? promise.promisedDueAt,
            suggestedAction: promise.suggestedAction,
          }),
        ),
        evidence,
      },
    };
  }

  private risks(
    opportunity: OpportunityPortfolioOpportunityRecord,
    followups: OpportunityPortfolioFollowupRecord[],
    latestFollowup: OpportunityPortfolioFollowupRecord | null,
    promises: TaskPromiseFulfillmentItem[],
    input: OpportunityDecisionInput,
    now: Date,
  ): OpportunityDecisionRisk[] {
    const risks: OpportunityDecisionRisk[] = [];
    const opportunityEvidence: string[] = [`opportunity:${opportunity.recordId}`];
    const dueTimestamp: number | null = validTimestamp(opportunity.dueAt);
    if (dueTimestamp !== null && dueTimestamp < now.getTime()) {
      risks.push(this.risk(
        'next_action_overdue',
        'high',
        '下一步已逾期',
        `计划截止时间为 ${opportunity.dueAt}，但商机仍处于推进范围。`,
        opportunityEvidence,
      ));
    }
    if (opportunity.status === 'unknown') {
      risks.push(this.risk(
        'lifecycle_unknown',
        'medium',
        '商机状态待确认',
        '当前状态无法映射为进行中、赢单、丢单或关闭。',
        opportunityEvidence,
      ));
    }
    if (followups.length === 0) {
      risks.push(this.risk(
        'no_followup_evidence',
        'medium',
        '没有关联跟进证据',
        '本人可见范围内没有找到与该商机明确关联的跟进记录。',
        opportunityEvidence,
      ));
    } else if (latestFollowup === null) {
      risks.push(this.risk(
        'followup_time_missing',
        'medium',
        '跟进时间缺失',
        '有关联跟进，但没有可信沟通时间，无法判断最近联系时间。',
        opportunityEvidence,
      ));
    } else {
      const latestTimestamp: number | null = validTimestamp(
        latestFollowup.communicationAt,
      );
      if (latestTimestamp !== null) {
        const currentDate: string = localDateKey(now, input.timezone);
        const followupDate: string = localDateKey(
          new Date(latestTimestamp),
          input.timezone,
        );
        const days: number = dateOrdinal(currentDate) - dateOrdinal(followupDate);
        if (days > STALE_FOLLOWUP_DAYS) {
          risks.push(this.risk(
            'followup_stale',
            days > CRITICAL_STALE_FOLLOWUP_DAYS ? 'high' : 'medium',
            `已 ${days} 天没有可信跟进`,
            `最近可信沟通时间为 ${latestFollowup.communicationAt}。`,
            [`followup:${latestFollowup.recordId}`],
          ));
        }
      }
    }
    promises.forEach((promise: TaskPromiseFulfillmentItem): void => {
      const evidenceIds: string[] = [
        `task-promise:${promise.pendingActionId}`,
      ];
      if (promise.status === 'open_overdue') {
        risks.push(this.risk(
          'confirmed_task_overdue',
          'high',
          '已确认任务逾期',
          promise.suggestedAction,
          evidenceIds,
        ));
      } else if (promise.status === 'open_changed') {
        risks.push(this.risk(
          'confirmed_task_changed',
          'medium',
          '已确认任务发生变化',
          promise.suggestedAction,
          evidenceIds,
        ));
      }
    });
    return risks;
  }

  private gaps(
    opportunity: OpportunityPortfolioOpportunityRecord,
    customer: OpportunityPortfolioCustomerRecord | null,
  ): OpportunityDecisionGap[] {
    const evidenceIds: string[] = [`opportunity:${opportunity.recordId}`];
    const definitions: Array<{
      missing: boolean;
      code: OpportunityDecisionGapCode;
      title: string;
      detail: string;
    }> = [
      {
        missing: customer === null,
        code: 'customer_missing',
        title: '关联客户缺失或不可见',
        detail: '无法把当前商机还原到唯一的本人客户记录。',
      },
      {
        missing: !opportunity.progress?.trim(),
        code: 'progress_missing',
        title: '当前进展未填写',
        detail: '缺少可用于判断项目所处阶段的当前进展。',
      },
      {
        missing: opportunity.expectedAmount === null,
        code: 'amount_missing',
        title: '预计金额未填写',
        detail: '缺少商机金额，排序未使用虚构的商业价值。',
      },
      {
        missing: !opportunity.nextAction?.trim(),
        code: 'next_action_missing',
        title: '下一步未明确',
        detail: '当前没有可执行的下一步行动。',
      },
      {
        missing: opportunity.dueAt === null,
        code: 'due_at_missing',
        title: '下一步时间未明确',
        detail: '当前下一步没有可信截止时间。',
      },
    ];
    return definitions
      .filter((definition): boolean => definition.missing)
      .map((definition): OpportunityDecisionGap => ({
        code: definition.code,
        title: definition.title,
        detail: definition.detail,
        evidenceIds,
      }));
  }

  private recommend(
    opportunity: OpportunityPortfolioOpportunityRecord,
    risks: OpportunityDecisionRisk[],
    gaps: OpportunityDecisionGap[],
  ): OpportunityDecisionRecommendation | null {
    const firstRisk: OpportunityDecisionRisk | undefined = risks[0];
    const firstGap: OpportunityDecisionGap | undefined = gaps[0];
    if (!firstRisk && !firstGap && !opportunity.nextAction?.trim()) return null;
    const confirmedTaskOverdue: OpportunityDecisionRisk | undefined =
      risks.find((risk: OpportunityDecisionRisk): boolean =>
        risk.code === 'confirmed_task_overdue');
    if (confirmedTaskOverdue) {
      return this.recommendation(
        '先核对逾期任务的真实状态，并重新确认负责人和完成时间。',
        confirmedTaskOverdue,
      );
    }
    if (firstRisk?.code === 'next_action_overdue') {
      return this.recommendation(
        '先确认原定下一步是否已经完成；未完成则重新约定动作和时间。',
        firstRisk,
      );
    }
    if (firstRisk?.code === 'followup_stale' ||
        firstRisk?.code === 'no_followup_evidence') {
      return this.recommendation(
        '联系客户确认当前状态、阻塞点和下一次具体行动。',
        firstRisk,
      );
    }
    if (firstRisk?.code === 'followup_time_missing') {
      return this.recommendation(
        '先补齐最近一次真实沟通时间，再判断是否需要立即跟进。',
        firstRisk,
      );
    }
    if (firstRisk?.code === 'lifecycle_unknown') {
      return this.recommendation(
        '先确认该商机仍在推进、已经赢单、丢单或关闭。',
        firstRisk,
      );
    }
    if (firstGap?.code === 'next_action_missing') {
      return this.gapRecommendation(
        '与客户约定一个具体下一步，并补齐负责人和完成时间。',
        firstGap,
      );
    }
    if (firstGap?.code === 'due_at_missing') {
      return this.gapRecommendation(
        `为“${opportunity.nextAction ?? '当前下一步'}”补充明确完成时间。`,
        firstGap,
      );
    }
    if (firstGap) {
      return this.gapRecommendation(
        `补齐“${firstGap.title}”所对应的真实信息。`,
        firstGap,
      );
    }
    return {
      action: opportunity.nextAction?.trim() ?? '',
      reason: '当前商机已有明确下一步，按现有计划推进。',
      dueAt: opportunity.dueAt,
      evidenceIds: [`opportunity:${opportunity.recordId}`],
      requiresConfirmation: true,
    };
  }

  private score(
    risks: OpportunityDecisionRisk[],
    gaps: OpportunityDecisionGap[],
  ): number {
    const riskScores: Record<OpportunityDecisionRiskCode, number> = {
      next_action_overdue: 45,
      followup_stale: 25,
      followup_time_missing: 20,
      no_followup_evidence: 22,
      lifecycle_unknown: 25,
      confirmed_task_overdue: 50,
      confirmed_task_changed: 20,
    };
    const gapScores: Record<OpportunityDecisionGapCode, number> = {
      customer_missing: 12,
      progress_missing: 10,
      amount_missing: 5,
      next_action_missing: 20,
      due_at_missing: 12,
    };
    const total: number = risks.reduce(
      (sum: number, risk: OpportunityDecisionRisk): number =>
        sum + riskScores[risk.code],
      0,
    ) + gaps.reduce(
      (sum: number, gap: OpportunityDecisionGap): number =>
        sum + gapScores[gap.code],
      0,
    );
    return Math.min(total, 100);
  }

  private health(
    risks: OpportunityDecisionRisk[],
    score: number,
  ): OpportunityDecisionHealth {
    const critical: boolean = risks.some(
      (risk: OpportunityDecisionRisk): boolean =>
        risk.code === 'confirmed_task_overdue' ||
        risk.code === 'next_action_overdue',
    );
    if (critical) return 'critical';
    if (risks.some(
      (risk: OpportunityDecisionRisk): boolean => risk.severity === 'high',
    ) || score >= 45) return 'at_risk';
    if (score > 0) return 'needs_attention';
    return 'on_track';
  }

  private globalTaskAlerts(
    taskReport: TaskFulfillmentResponse,
    priorities: OpportunityDecisionItem[],
  ): OpportunityDecisionGlobalTaskAlert[] {
    const alerts: OpportunityDecisionGlobalTaskAlert[] = [];
    if (taskReport.metrics.overdueCount > 0) {
      alerts.push({
        code: 'overdue_tasks',
        severity: 'high',
        title: '本人还有逾期任务',
        detail: `另有 ${taskReport.metrics.overdueCount} 条本人逾期任务；没有可靠关联时不绑定到具体商机`,
        count: taskReport.metrics.overdueCount,
      });
    }
    const knownNames: Set<string> = new Set(
      priorities.map((item: OpportunityDecisionItem): string =>
        normalize(item.name)),
    );
    const unlinkedCount: number = taskReport.promises.filter(
      (promise: TaskPromiseFulfillmentItem): boolean =>
        !promise.opportunityName ||
        !knownNames.has(normalize(promise.opportunityName)),
    ).length;
    if (unlinkedCount > 0) {
      alerts.push({
        code: 'unlinked_promises',
        severity: 'medium',
        title: '部分已确认承诺未关联进行中商机',
        detail: `${unlinkedCount} 条 Agent 已确认承诺没有唯一商机关联`,
        count: unlinkedCount,
      });
    }
    if (taskReport.status === 'partial' || taskReport.status === 'unavailable') {
      alerts.push({
        code: 'task_source_incomplete',
        severity: 'medium',
        title: '任务证据覆盖不完整',
        detail: '任务数据暂未完整覆盖，商机排序已降低对任务结论的依赖',
        count: taskReport.warnings.length,
      });
    }
    return alerts;
  }

  private groupPromises(
    promises: TaskPromiseFulfillmentItem[],
  ): Map<string, TaskPromiseFulfillmentItem[]> {
    const grouped: Map<string, TaskPromiseFulfillmentItem[]> = new Map();
    promises.forEach((promise: TaskPromiseFulfillmentItem): void => {
      const key: string = normalize(promise.opportunityName);
      if (!key) return;
      const items: TaskPromiseFulfillmentItem[] = grouped.get(key) ?? [];
      items.push(promise);
      grouped.set(key, items);
    });
    return grouped;
  }

  private latestFollowup(
    followups: OpportunityPortfolioFollowupRecord[],
  ): OpportunityPortfolioFollowupRecord | null {
    const trusted: OpportunityPortfolioFollowupRecord[] = followups
      .filter((followup: OpportunityPortfolioFollowupRecord): boolean =>
        validTimestamp(followup.communicationAt) !== null)
      .sort((left, right): number =>
        (validTimestamp(right.communicationAt) ?? 0) -
        (validTimestamp(left.communicationAt) ?? 0));
    return trusted[0] ?? null;
  }

  private summary(
    priorities: OpportunityDecisionItem[],
    excludedClosedOpportunityCount: number,
  ): OpportunityDecisionSummary {
    const count = (health: OpportunityDecisionHealth): number =>
      priorities.filter(
        (item: OpportunityDecisionItem): boolean => item.health === health,
      ).length;
    return {
      totalOpportunityCount:
        priorities.length + excludedClosedOpportunityCount,
      activeOpportunityCount: priorities.length,
      excludedClosedOpportunityCount,
      criticalCount: count('critical'),
      atRiskCount: count('at_risk'),
      needsAttentionCount: count('needs_attention'),
      onTrackCount: count('on_track'),
    };
  }

  private customers(
    customers: OpportunityPortfolioCustomerRecord[],
    priorities: OpportunityDecisionItem[],
  ): OpportunityDecisionCustomer[] {
    const summaries: OpportunityDecisionCustomer[] = customers.map(
      (
        customer: OpportunityPortfolioCustomerRecord,
      ): OpportunityDecisionCustomer => {
        const opportunities: OpportunityDecisionItem[] = priorities.filter(
          (item: OpportunityDecisionItem): boolean =>
            item.customerRecordId === customer.recordId,
        );
        const knownAmounts: number[] = opportunities
          .filter(
            (item: OpportunityDecisionItem): boolean =>
              item.expectedAmount !== null,
          )
          .map(
            (item: OpportunityDecisionItem): number =>
              item.expectedAmount ?? 0,
          );
        const top: OpportunityDecisionItem | undefined = opportunities[0];
        return {
          recordId: customer.recordId,
          recordUrl: customer.recordUrl,
          name: customer.name,
          contactName: customer.contactName,
          latestSummary: customer.latestSummary,
          lastFollowupAt: customer.lastFollowupAt,
          activeOpportunityCount: opportunities.length,
          criticalOpportunityCount: opportunities.filter(
            (item: OpportunityDecisionItem): boolean =>
              item.health === 'critical',
          ).length,
          atRiskOpportunityCount: opportunities.filter(
            (item: OpportunityDecisionItem): boolean =>
              item.health === 'at_risk',
          ).length,
          totalExpectedAmount: knownAmounts.length > 0
            ? knownAmounts.reduce(
                (total: number, amount: number): number => total + amount,
                0,
              )
            : null,
          topPriorityRank: top?.rank ?? null,
          topRecommendation: top?.recommendation?.action ?? null,
        };
      },
    );
    return summaries.sort(
      (
        left: OpportunityDecisionCustomer,
        right: OpportunityDecisionCustomer,
      ): number => {
        const rankDifference: number =
          (left.topPriorityRank ?? Number.MAX_SAFE_INTEGER) -
          (right.topPriorityRank ?? Number.MAX_SAFE_INTEGER);
        return rankDifference !== 0
          ? rankDifference
          : left.name.localeCompare(right.name, 'zh-CN');
      },
    );
  }

  private coverage(
    warnings: string[],
    taskReport: TaskFulfillmentResponse,
  ): OpportunityDecisionCoverage {
    const source = (
      prefix: string,
    ): 'complete' | 'partial' | 'unavailable' => {
      const sourceWarnings: string[] = warnings.filter(
        (warning: string): boolean => warning.includes(prefix),
      );
      if (sourceWarnings.some(
        (warning: string): boolean => warning.includes('scope_missing'),
      )) return 'unavailable';
      return sourceWarnings.length > 0 ? 'partial' : 'complete';
    };
    return {
      scope: 'self',
      customers: source('customer'),
      opportunities: source('opportunity'),
      followups: source('followup'),
      taskPromises: taskReport.status === 'unavailable'
        ? 'unavailable'
        : 'agent_confirmed_only',
      taskAssociation: 'explicit_agent_confirmation_only',
    };
  }

  private emptyResponse(
    input: OpportunityDecisionInput,
    now: Date,
  ): OpportunityDecisionResponse {
    return {
      referenceDate: input.referenceDate,
      timezone: input.timezone,
      status: 'empty',
      generatedAt: now.toISOString(),
      summary: {
        totalOpportunityCount: 0,
        activeOpportunityCount: 0,
        excludedClosedOpportunityCount: 0,
        criticalCount: 0,
        atRiskCount: 0,
        needsAttentionCount: 0,
        onTrackCount: 0,
      },
      customers: [],
      priorities: [],
      globalTaskAlerts: [],
      coverage: {
        scope: 'self',
        customers: 'unavailable',
        opportunities: 'unavailable',
        followups: 'unavailable',
        taskPromises: 'unavailable',
        taskAssociation: 'explicit_agent_confirmation_only',
      },
      warnings: [],
    };
  }

  private validDateAndTimezone(date: string, timezone: string): boolean {
    if (!/^\d{4}-\d{2}-\d{2}$/u.test(date)) return false;
    try {
      Intl.DateTimeFormat('en-US', { timeZone: timezone });
      return true;
    } catch (_error: unknown) {
      return false;
    }
  }

  private portfolioWarning(warning: string): string {
    const labels: Record<string, string> = {
      opportunity_portfolio_customer_scope_missing:
        '客户负责人字段未配置，客户名称可能缺失',
      opportunity_portfolio_opportunity_scope_missing:
        '商机负责人字段未配置，无法读取本人商机',
      opportunity_portfolio_followup_scope_missing:
        '跟进负责人字段未配置，跟进证据不可用',
      opportunity_portfolio_status_mapping_missing:
        '商机状态字段未配置，状态按待确认处理',
      opportunity_portfolio_status_values_missing:
        '商机状态值未配置，状态按待确认处理',
      opportunity_portfolio_communication_time_missing:
        '跟进沟通时间字段未配置，无法判断最近联系时间',
    };
    if (warning.includes('pagination')) {
      return '部分业务数据分页未完整返回，排序结果可能不完整';
    }
    return labels[warning] ?? warning;
  }

  private risk(
    code: OpportunityDecisionRiskCode,
    severity: 'high' | 'medium',
    title: string,
    detail: string,
    evidenceIds: string[],
  ): OpportunityDecisionRisk {
    return { code, severity, title, detail, evidenceIds };
  }

  private recommendation(
    action: string,
    risk: OpportunityDecisionRisk,
  ): OpportunityDecisionRecommendation {
    return {
      action,
      reason: risk.detail,
      dueAt: null,
      evidenceIds: risk.evidenceIds,
      requiresConfirmation: true,
    };
  }

  private gapRecommendation(
    action: string,
    gap: OpportunityDecisionGap,
  ): OpportunityDecisionRecommendation {
    return {
      action,
      reason: gap.detail,
      dueAt: null,
      evidenceIds: gap.evidenceIds,
      requiresConfirmation: true,
    };
  }

  private matchQuery(
    items: OpportunityDecisionItem[],
    query: string,
  ): OpportunityDecisionItem[] {
    const normalizedQuery: string = normalize(query);
    return items.filter((item: OpportunityDecisionItem): boolean =>
      normalizedQuery.includes(normalize(item.name)) ||
      Boolean(
        item.customerName &&
        normalizedQuery.includes(normalize(item.customerName)),
      ));
  }
}

export { OpportunityDecisionService };
export type { OpportunityDecisionInput };
