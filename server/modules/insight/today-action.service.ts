import { todayActionVersion } from './today-action-version';
import { Inject, Injectable } from '@nestjs/common';
import type { TodayActionResponse, TaskFulfillmentResponse, OpportunityDecisionResponse } from '@shared/api.interface';
import { SALES_RECORDS_GATEWAY, type SalesRecordsGateway } from '@server/modules/agent-core/agent.ports';
import type { TenantIntegration, OpportunityPortfolioResult } from '@server/modules/agent-core/agent.types';
import { TaskFulfillmentService } from './task-fulfillment.service';
import { OpportunityDecisionService } from './opportunity-decision.service';
import { buildTodayActions, hasTodayRecommendationEvidence } from './today-action-planner';
import { summarizeTodayCoverage } from './today-action-coverage';

interface TodayActionInput {
  integration: TenantIntegration;
  actorOpenId: string;
  referenceDate: string;
  timezone: string;
}

@Injectable()
class TodayActionService {
  constructor(
    @Inject(SALES_RECORDS_GATEWAY) private readonly records: SalesRecordsGateway,
    private readonly tasks: TaskFulfillmentService,
    private readonly decisions: OpportunityDecisionService,
  ) {}

  async analyze(input: TodayActionInput): Promise<TodayActionResponse> {
    const result: TodayActionResponse = {
      referenceDate: input.referenceDate, timezone: input.timezone,
      generatedAt: new Date().toISOString(), status: 'unavailable', items: [], warnings: [],
      coverage: { tasks: 'unavailable', portfolio: 'unavailable' },
    };
    if (input.integration.status !== 'active' || !input.actorOpenId.trim()) return result;
    buildTodayActions({ referenceDate: input.referenceDate, timezone: input.timezone,
      tasks: [], opportunities: [], followups: [] });
    const portfolioPromise: Promise<OpportunityPortfolioResult> = this.records.readOpportunityPortfolio
      ? this.records.readOpportunityPortfolio(input.integration, input.actorOpenId)
      : Promise.reject(new Error('Portfolio unavailable'));
    const sources = await Promise.allSettled([
      portfolioPromise,
      this.tasks.analyze({ ...input, readOnly: true }),
    ]);
    let portfolio: OpportunityPortfolioResult | undefined;
    let taskReport: TaskFulfillmentResponse | undefined;
    if (sources[0].status === 'fulfilled') {
      portfolio = sources[0].value;
      result.coverage.portfolio = portfolio.warnings.length ? 'partial' : 'complete';
      result.warnings.push(...portfolio.warnings);
    } else result.warnings.push('客户与商机来源暂不可用');
    if (sources[1].status === 'fulfilled') {
      taskReport = sources[1].value;
      result.coverage.tasks = taskReport.status === 'unavailable' ? 'unavailable'
        : taskReport.status === 'partial' ? 'partial' : 'complete';
      result.warnings.push(...taskReport.warnings);
    } else {
      result.warnings.push('任务来源暂不可用');
      taskReport = {
        referenceDate: input.referenceDate, timezone: input.timezone,
        generatedAt: result.generatedAt, status: 'unavailable',
        items: [], completedItems: [], promises: [], changes: [], recommendations: [],
        warnings: ['任务来源暂不可用'],
        metrics: {
          openTaskCount: 0, completedTaskCount: 0, overdueCount: 0, dueTodayCount: 0,
          dueSoonCount: 0, unscheduledCount: 0, scheduledCount: 0, promiseCount: 0,
          linkedOpenPromiseCount: 0, completedPromiseCount: 0, partiallyCompletedPromiseCount: 0,
          stillOpenPromiseCount: 0, changedPromiseCount: 0, overduePromiseCount: 0,
          untrackedPromiseCount: 0, unverifiablePromiseCount: 0,
        },
        coverage: { openTasks: true, completedTasks: 'unavailable',
          promiseReconciliation: 'agent_confirmed_only', promiseHistoryDays: 180,
          taskSnapshots: 'unavailable', taskHistory: 'unavailable' },
      };
    }
    let decisions: OpportunityDecisionResponse | undefined;
    if (portfolio) {
      try {
        decisions = await this.decisions.analyze({ ...input, portfolio, taskReport });
        if (decisions.status === 'unavailable') result.coverage.portfolio = 'unavailable';
        else if (decisions.status === 'partial') result.coverage.portfolio = 'partial';
        result.warnings.push(...decisions.warnings);
        const missingEvidence: boolean = decisions.priorities.some((opportunity): boolean => {
          if (['won', 'lost', 'closed'].includes(opportunity.lifecycleStatus)) return false;
          const ids: Set<string> = new Set(opportunity.evidence.map((item): string => item.id));
          return [...opportunity.risks, ...opportunity.gaps].some((signal): boolean =>
            signal.evidenceIds.length === 0 || signal.evidenceIds.some((id: string): boolean => !ids.has(id)),
          );
        });
        if (missingEvidence) {
          if (result.coverage.portfolio === 'complete') result.coverage.portfolio = 'partial';
          result.warnings.push('部分商机信号缺少关联证据，未生成行动事项');
        }
        const missingRecommendationEvidence: boolean = decisions.priorities.some((opportunity): boolean =>
          !['won', 'lost', 'closed'].includes(opportunity.lifecycleStatus) &&
          opportunity.recommendation != null && !hasTodayRecommendationEvidence(opportunity),
        );
        if (missingRecommendationEvidence) {
          if (result.coverage.portfolio === 'complete') result.coverage.portfolio = 'partial';
          result.warnings.push('部分商机建议缺少关联证据，已改为核实信息');
        }
      } catch {
        result.coverage.portfolio = 'partial';
        result.warnings.push('商机判断暂不可用');
      }
    }
    const planned = buildTodayActions({ referenceDate: input.referenceDate, timezone: input.timezone,
      tasks: taskReport?.items ?? [], opportunities: decisions?.priorities ?? [],
      followups: portfolio?.followups ?? [] });
    result.items = planned.map((item) => {
      const version: string = todayActionVersion(item);
      return { ...item, version, state: { itemId: item.id, itemVersion: version,
        revision: 0, status: 'open' as const, remindAt: null } };
    });
    result.status = summarizeTodayCoverage(result.coverage, result.items.length);
    return result;
  }
}

export { TodayActionService };


