import type {
  ProactiveNotificationReconciliationDecision,
  ProactiveSalesNotificationKind,
} from '@shared/api.interface';

const KIND_LABELS: Record<ProactiveSalesNotificationKind, string> = {
  task_action: '任务行动提醒',
  opportunity_risk: '商机风险提醒',
  daily_report: '销售日报',
  weekly_personal: '个人周报',
  weekly_team: '团队周报',
};

const DECISION_LABELS: Record<
  ProactiveNotificationReconciliationDecision,
  string
> = {
  confirm_sent: '确认已送达',
  authorize_retry: '确认未送达并释放一次重试',
  keep_frozen: '证据不足，继续冻结',
};

const DECISION_DESCRIPTIONS: Record<
  ProactiveNotificationReconciliationDecision,
  string
> = {
  confirm_sent: '将账本记为已送达，之后不会再发送这条通知。',
  authorize_retry: '只释放一次后续尝试；本次裁决不会立即发送消息。',
  keep_frozen: '保留未知状态，等待获得更可靠的飞书消息证据。',
};

const proactiveNotificationKindLabel = (
  kind: ProactiveSalesNotificationKind,
): string => KIND_LABELS[kind];

const proactiveNotificationDecisionLabel = (
  decision: ProactiveNotificationReconciliationDecision,
): string => DECISION_LABELS[decision];

const proactiveNotificationDecisionDescription = (
  decision: ProactiveNotificationReconciliationDecision,
): string => DECISION_DESCRIPTIONS[decision];

const shouldAllowNotificationReconciliationDialogChange = (
  open: boolean,
  saving: boolean,
): boolean => open || !saving;

export {
  proactiveNotificationDecisionDescription,
  proactiveNotificationDecisionLabel,
  proactiveNotificationKindLabel,
  shouldAllowNotificationReconciliationDialogChange,
};
