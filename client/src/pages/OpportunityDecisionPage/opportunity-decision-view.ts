import type {
  OpportunityDecisionHealth,
  OpportunityDecisionItem,
} from '@shared/api.interface';

interface HealthView {
  label: string;
  badgeClassName: string;
  accentClassName: string;
}

const healthView: Record<OpportunityDecisionHealth, HealthView> = {
  critical: {
    label: '立即处理',
    badgeClassName: 'border-destructive/30 bg-destructive/10 text-destructive',
    accentClassName: 'border-l-destructive',
  },
  at_risk: {
    label: '存在风险',
    badgeClassName: 'border-amber-300 bg-amber-50 text-amber-800',
    accentClassName: 'border-l-amber-500',
  },
  needs_attention: {
    label: '需要关注',
    badgeClassName: 'border-primary/20 bg-primary/10 text-primary',
    accentClassName: 'border-l-primary',
  },
  on_track: {
    label: '正常推进',
    badgeClassName: 'border-emerald-200 bg-emerald-50 text-emerald-800',
    accentClassName: 'border-l-emerald-500',
  },
};

const formatDecisionAmount = (amount: number | null): string =>
  amount === null
    ? '金额未提供'
    : new Intl.NumberFormat('zh-CN', {
        maximumFractionDigits: 2,
      }).format(amount);

const formatDecisionDateTime = (value: string | null): string => {
  if (value === null) return '时间未提供';
  const date: Date = new Date(value);
  if (Number.isNaN(date.getTime())) return '时间无效';
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date);
};

const resolveSelectedOpportunity = (
  priorities: OpportunityDecisionItem[],
  selectedRecordId: string | null,
): OpportunityDecisionItem | null => {
  if (priorities.length === 0) return null;
  return priorities.find(
    (item: OpportunityDecisionItem): boolean =>
      item.recordId === selectedRecordId,
  ) ?? priorities[0] ?? null;
};

export {
  formatDecisionAmount,
  formatDecisionDateTime,
  healthView,
  resolveSelectedOpportunity,
};
