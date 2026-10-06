import type { OpportunityDecisionHealth } from '@shared/api.interface';

const HEALTH_LABELS: Record<OpportunityDecisionHealth, string> = {
  critical: '立即介入',
  at_risk: '存在风险',
  needs_attention: '需要关注',
  on_track: '按计划推进',
};

const teamOpportunityHealthLabel = (
  health: OpportunityDecisionHealth,
): string => HEALTH_LABELS[health];

const formatTeamOpportunityAmount = (amount: number | null): string =>
  amount === null
    ? '金额待补充'
    : new Intl.NumberFormat('zh-CN', {
        style: 'currency',
        currency: 'CNY',
        maximumFractionDigits: 0,
      }).format(amount).replace('CN¥', '¥');

const validTeamOpportunitySelection = (
  selectedKey: string | null,
  priorities: Array<{ key: string }>,
): string | null => {
  if (
    selectedKey !== null &&
    priorities.some((item: { key: string }): boolean => item.key === selectedKey)
  ) return selectedKey;
  return priorities[0]?.key ?? null;
};

export {
  formatTeamOpportunityAmount,
  teamOpportunityHealthLabel,
  validTeamOpportunitySelection,
};
