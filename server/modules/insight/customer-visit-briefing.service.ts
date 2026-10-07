import { Inject, Injectable, Logger } from '@nestjs/common';

import type {
  CustomerVisitBriefingCoverage,
  CustomerVisitBriefingFollowup,
  CustomerVisitBriefingOpportunity,
  CustomerVisitBriefingQuestion,
  CustomerVisitBriefingResponse,
  OpportunityDecisionItem,
  OpportunityDecisionResponse,
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
import {
  buildVisitCoverage,
  compareVisitFollowups,
  compareVisitOpportunities,
  customerVisitResponseShell,
  isActiveVisitOpportunity,
  mapVisitFollowup,
  mapVisitOpportunity,
  mapVisitPortfolioWarnings,
  unavailableVisitDecision,
  validVisitDateAndTimezone,
} from './customer-visit-briefing-data';
import {
  buildCustomerVisitAgenda,
  buildCustomerVisitQuestions,
} from './customer-visit-briefing-questions';
import {
  OpportunityDecisionService,
  type OpportunityDecisionInput,
} from './opportunity-decision.service';

interface CustomerVisitBriefingInput {
  integration: TenantIntegration;
  actorOpenId: string;
  customerRecordId: string;
  referenceDate: string;
  timezone: string;
  now?: Date;
}

interface CustomerVisitDecisionAnalyzer {
  analyze(input: OpportunityDecisionInput): Promise<OpportunityDecisionResponse>;
}

const MAX_RECENT_FOLLOWUPS = 10;

@Injectable()
class CustomerVisitBriefingService {
  private readonly logger: Logger = new Logger(
    CustomerVisitBriefingService.name,
  );

  constructor(
    @Inject(SALES_RECORDS_GATEWAY)
    private readonly records: SalesRecordsGateway,
    @Inject(OpportunityDecisionService)
    private readonly decisions: CustomerVisitDecisionAnalyzer,
  ) {}

  async generate(
    input: CustomerVisitBriefingInput,
  ): Promise<CustomerVisitBriefingResponse> {
    const now: Date = input.now ?? new Date();
    const earlyResponse: CustomerVisitBriefingResponse | null =
      this.validateInput(input, now);
    if (earlyResponse !== null) return earlyResponse;

    const portfolio: OpportunityPortfolioResult | null =
      await this.readPortfolio(input);
    if (portfolio === null) {
      return this.unavailable(input, now, ['客户与商机数据源暂时不可用']);
    }

    const coverage: CustomerVisitBriefingCoverage = buildVisitCoverage(
      portfolio.warnings,
      null,
    );
    const customer: OpportunityPortfolioCustomerRecord | undefined =
      portfolio.customers.find(
        (item: OpportunityPortfolioCustomerRecord): boolean =>
          item.recordId === input.customerRecordId,
      );
    if (!customer) {
      if (coverage.customers === 'unavailable') {
        return this.unavailable(
          input,
          now,
          ['客户负责人范围不可用，无法准备拜访攻略'],
        );
      }
      return this.empty(input, now, ['客户不存在或不在本人可见范围内']);
    }

    const decisionReport: OpportunityDecisionResponse =
      await this.readDecision(input, now, portfolio);
    return this.buildResponse(input, now, portfolio, customer, decisionReport);
  }

  private validateInput(
    input: CustomerVisitBriefingInput,
    now: Date,
  ): CustomerVisitBriefingResponse | null {
    if (
      input.integration.status !== 'active' ||
      !input.actorOpenId.trim() ||
      !input.customerRecordId.trim()
    ) {
      return this.unavailable(input, now, ['当前销售身份或销售数据连接不可用']);
    }
    if (!validVisitDateAndTimezone(input.referenceDate, input.timezone)) {
      return this.unavailable(input, now, ['检查日期或销售时区无效']);
    }
    if (!this.records.readOpportunityPortfolio) {
      return this.unavailable(input, now, ['客户与商机组合数据源未配置']);
    }
    return null;
  }

  private async readPortfolio(
    input: CustomerVisitBriefingInput,
  ): Promise<OpportunityPortfolioResult | null> {
    const reader: SalesRecordsGateway['readOpportunityPortfolio'] =
      this.records.readOpportunityPortfolio;
    if (!reader) return null;
    try {
      return await reader(input.integration, input.actorOpenId);
    } catch (error: unknown) {
      this.logger.warn(
        `Customer visit portfolio read failed: ${error instanceof Error
          ? error.message
          : String(error)}`,
      );
      return null;
    }
  }

  private async readDecision(
    input: CustomerVisitBriefingInput,
    now: Date,
    portfolio: OpportunityPortfolioResult,
  ): Promise<OpportunityDecisionResponse> {
    try {
      return await this.decisions.analyze({
        integration: input.integration,
        actorOpenId: input.actorOpenId,
        referenceDate: input.referenceDate,
        timezone: input.timezone,
        now,
        portfolio,
      });
    } catch (error: unknown) {
      this.logger.warn(
        `Customer visit decision read failed: ${error instanceof Error
          ? error.message
          : String(error)}`,
      );
      return unavailableVisitDecision(input, now);
    }
  }

  private buildResponse(
    input: CustomerVisitBriefingInput,
    now: Date,
    portfolio: OpportunityPortfolioResult,
    customer: OpportunityPortfolioCustomerRecord,
    decisionReport: OpportunityDecisionResponse,
  ): CustomerVisitBriefingResponse {
    const relatedPortfolioOpportunities: OpportunityPortfolioOpportunityRecord[] =
      portfolio.opportunities.filter(
        (opportunity: OpportunityPortfolioOpportunityRecord): boolean =>
          opportunity.customerRecordId === customer.recordId,
      );
    const decisionByRecordId: Map<string, OpportunityDecisionItem> = new Map(
      decisionReport.priorities.map(
        (item: OpportunityDecisionItem): [string, OpportunityDecisionItem] => [
          item.recordId,
          item,
        ],
      ),
    );
    const opportunities: CustomerVisitBriefingOpportunity[] =
      relatedPortfolioOpportunities
        .map(
          (
            opportunity: OpportunityPortfolioOpportunityRecord,
          ): CustomerVisitBriefingOpportunity => mapVisitOpportunity(
            opportunity,
            decisionByRecordId.get(opportunity.recordId),
          ),
        )
        .sort((left, right): number => compareVisitOpportunities(
          left,
          right,
          decisionByRecordId,
        ));
    const allFollowups: OpportunityPortfolioFollowupRecord[] =
      this.relatedFollowups(
        portfolio.followups,
        relatedPortfolioOpportunities,
        customer.recordId,
      );
    const recentFollowups: CustomerVisitBriefingFollowup[] =
      this.recentFollowups(allFollowups, relatedPortfolioOpportunities);
    const warnings: string[] = Array.from(new Set([
      ...decisionReport.warnings,
      ...mapVisitPortfolioWarnings(portfolio.warnings),
    ]));
    const active: CustomerVisitBriefingOpportunity[] = opportunities.filter(
      (opportunity: CustomerVisitBriefingOpportunity): boolean =>
        isActiveVisitOpportunity(opportunity.lifecycleStatus),
    );
    const knownAmounts: number[] = active
      .filter(
        (opportunity: CustomerVisitBriefingOpportunity): boolean =>
          opportunity.expectedAmount !== null,
      )
      .map(
        (opportunity: CustomerVisitBriefingOpportunity): number =>
          opportunity.expectedAmount ?? 0,
      );
    const questions: CustomerVisitBriefingQuestion[] =
      buildCustomerVisitQuestions(customer, active);
    return {
      referenceDate: input.referenceDate,
      timezone: input.timezone,
      status: warnings.length > 0 ||
        decisionReport.status === 'partial' ||
        decisionReport.status === 'unavailable'
        ? 'partial'
        : 'ready',
      generatedAt: now.toISOString(),
      customer: {
        recordId: customer.recordId,
        name: customer.name,
        contactName: customer.contactName,
        latestSummary: customer.latestSummary,
        lastFollowupAt: customer.lastFollowupAt,
        source: {
          recordId: customer.recordId,
          recordUrl: customer.recordUrl,
          sourceVersion: customer.sourceVersion,
        },
      },
      metrics: {
        relatedOpportunityCount: opportunities.length,
        activeOpportunityCount: active.length,
        riskOpportunityCount: active.filter(
          (opportunity: CustomerVisitBriefingOpportunity): boolean =>
            opportunity.health === 'critical' ||
            opportunity.health === 'at_risk',
        ).length,
        totalFollowupCount: allFollowups.length,
        knownActiveExpectedAmount: knownAmounts.length === 0
          ? null
          : knownAmounts.reduce(
              (sum: number, amount: number): number => sum + amount,
              0,
            ),
      },
      opportunities,
      recentFollowups,
      questions,
      agenda: buildCustomerVisitAgenda(opportunities, allFollowups.length),
      coverage: buildVisitCoverage(portfolio.warnings, decisionReport),
      warnings,
    };
  }

  private relatedFollowups(
    followups: OpportunityPortfolioFollowupRecord[],
    opportunities: OpportunityPortfolioOpportunityRecord[],
    customerRecordId: string,
  ): OpportunityPortfolioFollowupRecord[] {
    const opportunityIds: Set<string> = new Set(
      opportunities.map(
        (opportunity: OpportunityPortfolioOpportunityRecord): string =>
          opportunity.recordId,
      ),
    );
    return followups.filter(
      (followup: OpportunityPortfolioFollowupRecord): boolean =>
        followup.customerRecordId === customerRecordId ||
        (
          followup.customerRecordId === null &&
          followup.opportunityRecordId !== null &&
          opportunityIds.has(followup.opportunityRecordId)
        ),
    );
  }

  private recentFollowups(
    followups: OpportunityPortfolioFollowupRecord[],
    opportunities: OpportunityPortfolioOpportunityRecord[],
  ): CustomerVisitBriefingFollowup[] {
    const opportunityNameById: Map<string, string> = new Map(
      opportunities.map(
        (opportunity: OpportunityPortfolioOpportunityRecord): [string, string] =>
          [opportunity.recordId, opportunity.name],
      ),
    );
    return followups
      .sort(compareVisitFollowups)
      .slice(0, MAX_RECENT_FOLLOWUPS)
      .map(
        (followup: OpportunityPortfolioFollowupRecord):
        CustomerVisitBriefingFollowup => mapVisitFollowup(
          followup,
          opportunityNameById,
        ),
      );
  }

  private empty(
    input: CustomerVisitBriefingInput,
    now: Date,
    warnings: string[],
  ): CustomerVisitBriefingResponse {
    return {
      ...customerVisitResponseShell(input, now),
      status: 'empty',
      warnings,
    };
  }

  private unavailable(
    input: CustomerVisitBriefingInput,
    now: Date,
    warnings: string[],
  ): CustomerVisitBriefingResponse {
    return {
      ...customerVisitResponseShell(input, now),
      status: 'unavailable',
      warnings,
    };
  }
}

export { CustomerVisitBriefingService };
export type {
  CustomerVisitBriefingInput,
  CustomerVisitDecisionAnalyzer,
};
