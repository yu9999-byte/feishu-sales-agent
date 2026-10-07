import type {
  CustomerVisitBriefingCoverage,
  CustomerVisitBriefingFollowup,
  CustomerVisitBriefingOpportunity,
  CustomerVisitBriefingResponse,
  OpportunityDecisionItem,
  OpportunityDecisionResponse,
} from '@shared/api.interface';
import type {
  OpportunityPortfolioFollowupRecord,
  OpportunityPortfolioOpportunityRecord,
} from '@server/modules/agent-core/agent.types';

const validTimestamp = (value: string | null): number | null => {
  if (value === null) return null;
  const timestamp: number = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : null;
};

const isActiveVisitOpportunity = (
  status: OpportunityPortfolioOpportunityRecord['status'],
): boolean => status === 'active' || status === 'unknown';

const mapVisitOpportunity = (
  opportunity: OpportunityPortfolioOpportunityRecord,
  decision: OpportunityDecisionItem | undefined,
): CustomerVisitBriefingOpportunity => ({
  recordId: opportunity.recordId,
  name: opportunity.name,
  lifecycleStatus: opportunity.status,
  expectedAmount: opportunity.expectedAmount,
  progress: opportunity.progress,
  nextAction: opportunity.nextAction,
  dueAt: opportunity.dueAt,
  health: decision?.health ?? null,
  risks: decision?.risks ?? [],
  gaps: decision?.gaps ?? [],
  recommendation: decision?.recommendation ?? null,
  source: {
    recordId: opportunity.recordId,
    recordUrl: opportunity.recordUrl,
    sourceVersion: opportunity.sourceVersion,
  },
});

const lifecycleOrder = (
  status: CustomerVisitBriefingOpportunity['lifecycleStatus'],
): number => {
  const order: Record<
    CustomerVisitBriefingOpportunity['lifecycleStatus'],
    number
  > = {
    active: 0,
    unknown: 1,
    won: 2,
    lost: 3,
    closed: 4,
  };
  return order[status];
};

const compareVisitOpportunities = (
  left: CustomerVisitBriefingOpportunity,
  right: CustomerVisitBriefingOpportunity,
  decisionByRecordId: Map<string, OpportunityDecisionItem>,
): number => {
  const leftDecision: OpportunityDecisionItem | undefined =
    decisionByRecordId.get(left.recordId);
  const rightDecision: OpportunityDecisionItem | undefined =
    decisionByRecordId.get(right.recordId);
  if (leftDecision && rightDecision) {
    return leftDecision.rank - rightDecision.rank;
  }
  if (leftDecision) return -1;
  if (rightDecision) return 1;
  const lifecycleDifference: number =
    lifecycleOrder(left.lifecycleStatus) - lifecycleOrder(right.lifecycleStatus);
  return lifecycleDifference !== 0
    ? lifecycleDifference
    : left.name.localeCompare(right.name, 'zh-CN');
};

const compareVisitFollowups = (
  left: OpportunityPortfolioFollowupRecord,
  right: OpportunityPortfolioFollowupRecord,
): number => {
  const leftTimestamp: number | null = validTimestamp(left.communicationAt);
  const rightTimestamp: number | null = validTimestamp(right.communicationAt);
  if (leftTimestamp !== null && rightTimestamp !== null) {
    return rightTimestamp - leftTimestamp;
  }
  if (leftTimestamp !== null) return -1;
  if (rightTimestamp !== null) return 1;
  return left.recordId.localeCompare(right.recordId, 'zh-CN');
};

const mapVisitFollowup = (
  followup: OpportunityPortfolioFollowupRecord,
  opportunityNameById: Map<string, string>,
): CustomerVisitBriefingFollowup => ({
  recordId: followup.recordId,
  opportunityRecordId: followup.opportunityRecordId,
  opportunityName: followup.opportunityRecordId === null
    ? null
    : opportunityNameById.get(followup.opportunityRecordId) ?? null,
  summary: followup.summary,
  communicationAt: followup.communicationAt,
  nextAction: followup.nextAction,
  dueAt: followup.dueAt,
  source: {
    recordId: followup.recordId,
    recordUrl: followup.recordUrl,
    sourceVersion: followup.sourceVersion,
  },
});

const buildVisitCoverage = (
  warnings: string[],
  report: OpportunityDecisionResponse | null,
): CustomerVisitBriefingCoverage => {
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
    taskPromises: report?.coverage.taskPromises ?? 'unavailable',
    associations: 'explicit_record_links_only',
  };
};

const mapVisitPortfolioWarnings = (warnings: string[]): string[] => {
  const labels: Record<string, string> = {
    opportunity_portfolio_customer_scope_missing:
      '客户负责人字段未配置，客户来源不可用',
    opportunity_portfolio_opportunity_scope_missing:
      '商机负责人字段未配置，无法完整读取本人商机',
    opportunity_portfolio_followup_scope_missing:
      '跟进负责人字段未配置，跟进历史不可用',
    opportunity_portfolio_status_mapping_missing:
      '商机状态字段未配置，进行中状态需要人工核对',
    opportunity_portfolio_status_values_missing:
      '商机状态值未配置，进行中状态需要人工核对',
    opportunity_portfolio_communication_time_missing:
      '跟进沟通时间字段未配置，最近联系时间不可核实',
  };
  return warnings.map((warning: string): string => {
    if (warning.includes('pagination')) {
      return '部分客户资料分页未完整返回，拜访攻略可能不完整';
    }
    return labels[warning] ?? warning;
  });
};

const validVisitDateAndTimezone = (
  date: string,
  timezone: string,
): boolean => {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(date)) return false;
  try {
    Intl.DateTimeFormat('en-US', { timeZone: timezone });
    return true;
  } catch (_error: unknown) {
    return false;
  }
};

interface VisitResponseContext {
  referenceDate: string;
  timezone: string;
}

const customerVisitResponseShell = (
  input: VisitResponseContext,
  now: Date,
): CustomerVisitBriefingResponse => ({
  referenceDate: input.referenceDate,
  timezone: input.timezone,
  status: 'empty',
  generatedAt: now.toISOString(),
  customer: null,
  metrics: {
    relatedOpportunityCount: 0,
    activeOpportunityCount: 0,
    riskOpportunityCount: 0,
    totalFollowupCount: 0,
    knownActiveExpectedAmount: null,
  },
  opportunities: [],
  recentFollowups: [],
  questions: [],
  agenda: [],
  coverage: {
    scope: 'self',
    customers: 'unavailable',
    opportunities: 'unavailable',
    followups: 'unavailable',
    taskPromises: 'unavailable',
    associations: 'explicit_record_links_only',
  },
  warnings: [],
});

const unavailableVisitDecision = (
  input: VisitResponseContext,
  now: Date,
): OpportunityDecisionResponse => ({
  referenceDate: input.referenceDate,
  timezone: input.timezone,
  status: 'unavailable',
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
    customers: 'complete',
    opportunities: 'partial',
    followups: 'partial',
    taskPromises: 'unavailable',
    taskAssociation: 'explicit_agent_confirmation_only',
  },
  warnings: ['商机风险决策暂时不可用'],
});

export {
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
};
