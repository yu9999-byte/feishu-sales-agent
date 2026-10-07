import type {
  CustomerVisitBriefingStatus,
  OpportunityDecisionHealth,
} from '@shared/api.interface';

const STATUS_LABELS: Record<CustomerVisitBriefingStatus, string> = {
  ready: '资料已准备',
  partial: '部分资料可用',
  empty: '客户不可见',
  unavailable: '暂时无法准备',
};

const HEALTH_LABELS: Record<OpportunityDecisionHealth, string> = {
  critical: '立即核对',
  at_risk: '存在风险',
  needs_attention: '需要关注',
  on_track: '按计划推进',
};

const customerBriefingStatusLabel = (
  status: CustomerVisitBriefingStatus,
): string => STATUS_LABELS[status];

const customerBriefingHealthLabel = (
  health: OpportunityDecisionHealth | null,
): string => health === null ? '历史商机' : HEALTH_LABELS[health];

const formatCustomerBriefingAmount = (amount: number | null): string =>
  amount === null
    ? '金额待确认'
    : new Intl.NumberFormat('zh-CN', {
        style: 'currency',
        currency: 'CNY',
        maximumFractionDigits: 0,
      }).format(amount).replace('CN¥', '¥');

const formatCustomerBriefingDate = (value: string | null): string => {
  if (value === null) return '时间待确认';
  const timestamp: number = Date.parse(value);
  if (!Number.isFinite(timestamp)) return '时间待确认';
  return new Intl.DateTimeFormat('zh-CN', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(timestamp));
};

export {
  customerBriefingHealthLabel,
  customerBriefingStatusLabel,
  formatCustomerBriefingAmount,
  formatCustomerBriefingDate,
};
