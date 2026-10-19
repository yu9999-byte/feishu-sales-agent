import type {
  OpportunityDecisionItem,
  TaskFulfillmentItem,
  TodayActionItem,
} from '@shared/api.interface';
import type { OpportunityPortfolioFollowupRecord } from
  '@server/modules/agent-core/agent.types';

interface TodayActionInput {
  referenceDate: string;
  timezone?: string;
  tasks: TaskFulfillmentItem[];
  opportunities: OpportunityDecisionItem[];
  followups: OpportunityPortfolioFollowupRecord[];
}

const hasTodayRecommendationEvidence = (opportunity: OpportunityDecisionItem): boolean => {
  const recommendation = opportunity.recommendation;
  if (!recommendation || recommendation.evidenceIds.length === 0) return false;
  const evidenceIds: Set<string> = new Set(opportunity.evidence.map((item): string => item.id));
  return recommendation.evidenceIds.every((id: string): boolean => evidenceIds.has(id));
};

const safeSourceUrl = (value: string | null): string | null => {
  if (!value) return null;
  try {
    const url: URL = new URL(value);
    return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password
      ? url.href : null;
  } catch {
    return null;
  }
};

const buildTodayActions = (input: TodayActionInput): TodayActionItem[] => {
  const reference: Date = new Date(`${input.referenceDate}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(input.referenceDate) ||
    !Number.isFinite(reference.getTime()) ||
    reference.toISOString().slice(0, 10) !== input.referenceDate) {
    throw new RangeError('Invalid action reference date');
  }
  new Intl.DateTimeFormat('en', { timeZone: input.timezone ?? 'Asia/Shanghai' });
  const localDate = (value: string | null | undefined): string => {
    if (!value) return input.referenceDate;
    const parsed: Date = new Date(value);
    if (!Number.isFinite(parsed.getTime())) return input.referenceDate;
    if (/^\d{4}-\d{2}-\d{2}$/u.test(value)) return value;
    const parts: Intl.DateTimeFormatPart[] = new Intl.DateTimeFormat('en-CA', {
      timeZone: input.timezone ?? 'Asia/Shanghai',
      year: 'numeric', month: '2-digit', day: '2-digit',
    }).formatToParts(parsed);
    return ['year', 'month', 'day'].map((type: string): string =>
      parts.find((part: Intl.DateTimeFormatPart): boolean => part.type === type)?.value ?? '',
    ).join('-');
  };
  const items: Map<string, TodayActionItem> = new Map();
  const orderedTasks: TaskFulfillmentItem[] = [...input.tasks].sort(
    (left: TaskFulfillmentItem, right: TaskFulfillmentItem): number =>
      (left.daysUntilDue ?? Infinity) - (right.daysUntilDue ?? Infinity) ||
      left.guid.localeCompare(right.guid),
  );
  for (const task of orderedTasks) {
    if (!task.dueAt && !task.dueDate) continue;
    if (task.completedAt || ['completed', 'done'].includes(task.status.toLowerCase()) ||
      task.daysUntilDue === null || task.daysUntilDue > 1) continue;
    const id: string = `task:${task.guid}`;
    items.set(id, {
      id, kind: 'task', sourceId: task.guid, customerRecordId: null,
      title: task.title,
      reason: task.daysUntilDue < 0 ? '任务已逾期' : '任务即将到期',
      evidence: [`截止时间：${task.dueAt ?? task.dueDate}`],
      suggestedAction: task.suggestedAction,
      suggestedCompletionDate: input.referenceDate, sourceUrl: safeSourceUrl(task.url),
    });
  }
  for (const followup of input.followups) {
    if (!followup.customerRecordId || !followup.nextAction || !followup.dueAt) continue;
    const timestamp: Date = new Date(followup.dueAt);
    if (!Number.isFinite(timestamp.getTime())) continue;
    const parts: Intl.DateTimeFormatPart[] = new Intl.DateTimeFormat('en-CA', {
      timeZone: input.timezone ?? 'Asia/Shanghai',
      year: 'numeric', month: '2-digit', day: '2-digit',
    }).formatToParts(timestamp);
    const date: string = ['year', 'month', 'day'].map(
      (type: string): string => parts.find(
        (part: Intl.DateTimeFormatPart): boolean => part.type === type,
      )?.value ?? '',
    ).join('-');
    if (date !== input.referenceDate) continue;
    const id: string = `followup:${followup.recordId}`;
    items.set(id, {
      id, kind: 'customer_followup', sourceId: followup.recordId,
      customerRecordId: followup.customerRecordId,
      title: followup.nextAction, reason: '客户跟进计划今日到期',
      evidence: [followup.summary, `计划时间：${followup.dueAt}`],
      suggestedAction: followup.nextAction,
      suggestedCompletionDate: input.referenceDate, sourceUrl: safeSourceUrl(followup.recordUrl),
    });
  }
  for (const opportunity of input.opportunities) {
    if (['won', 'lost', 'closed'].includes(opportunity.lifecycleStatus)) continue;
    const evidenceIds: Set<string> = new Set(opportunity.evidence.map((item): string => item.id));
    const reasons = [...opportunity.risks, ...opportunity.gaps].filter((item): boolean =>
      item.evidenceIds.length > 0 && item.evidenceIds.every((id: string): boolean => evidenceIds.has(id)),
    );
    if (reasons.length === 0) continue;
    const recommendation = hasTodayRecommendationEvidence(opportunity) ? opportunity.recommendation : null;
    const usedEvidence: Set<string> = new Set(reasons.flatMap((item): string[] => item.evidenceIds));
    for (const id of recommendation?.evidenceIds ?? []) usedEvidence.add(id);
    const evidence: string[] = opportunity.evidence.filter((item): boolean => usedEvidence.has(item.id)).map(
      (item): string => `${item.label}：${item.value}`,
    );
    if (evidence.length === 0) continue;
    const id: string = `opportunity:${opportunity.recordId}`;
    items.set(id, {
      id, kind: 'opportunity', sourceId: opportunity.recordId,
      customerRecordId: opportunity.customerRecordId, title: opportunity.name,
      reason: reasons.map(
        (item): string => item.title,
      ).join('；'),
      evidence,
      suggestedAction: recommendation?.action ?? '核实并补充商机信息',
      suggestedCompletionDate: localDate(recommendation?.dueAt),
      sourceUrl: safeSourceUrl(opportunity.recordUrl),
    });
  }
  return [...items.values()];
};

export { buildTodayActions, hasTodayRecommendationEvidence };






