import { createHash } from 'node:crypto';
import type { TodayActionState, TodayActionViewItem } from '@shared/api.interface';
import type { ProactiveNotificationMessage } from './proactive-notification-delivery.service';
import type { ProactiveNotificationPlanScope } from './proactive-notification-planner.service';

const planDueTodayActionReminders = (
  scope: ProactiveNotificationPlanScope,
  items: TodayActionViewItem[],
  states: TodayActionState[],
  now: Date,
): ProactiveNotificationMessage[] => {
  if (!Number.isFinite(now.getTime())) throw new Error('INVALID_REFERENCE_TIME');
  const messages: ProactiveNotificationMessage[] = [];
  const seen: Set<string> = new Set();
  for (const state of states) {
    if (state.status !== 'snoozed' || !state.remindAt) continue;
    const due: number = Date.parse(state.remindAt);
    if (!Number.isFinite(due) || due > now.getTime()) continue;
    const item = items.find((candidate) => candidate.id === state.itemId &&
      candidate.version === state.itemVersion);
    if (!item) continue;
    const occurrence: string = createHash('sha256').update(JSON.stringify([
      state.itemId, state.itemVersion, state.revision,
    ])).digest('hex');
    if (seen.has(occurrence)) continue;
    seen.add(occurrence);
    const sections = [{ title: item.title, lines: [
      `提醒原因：${item.reason}`, `判断证据：${item.evidence.join('；')}`,
      `建议动作：${item.suggestedAction}`, `建议完成时间：${item.suggestedCompletionDate}`,
    ] }];
    const value = { action: 'today_action' as const, recipientOpenId: scope.recipientOpenId,
      itemId: item.id, itemVersion: item.version, expectedRevision: state.revision };
    const shortcuts: NonNullable<ProactiveNotificationMessage['shortcuts']> = [
      { label: '标记已处理', value: { ...value, operation: 'resolve',
        idempotencyKey: `reminder:${occurrence}:resolve` } },
      { label: '生成跟进', value: { ...value, operation: 'generate_followup',
        idempotencyKey: `reminder:${occurrence}:followup` } },
      { label: '创建任务', value: { ...value, operation: 'create_task',
        idempotencyKey: `reminder:${occurrence}:task` } },
      { label: '一小时后再次提醒', value: { ...value, operation: 'snooze',
        idempotencyKey: `reminder:${occurrence}:snooze`,
        remindAt: new Date(now.getTime() + 3600000).toISOString() } },
    ];
    messages.push({ tenantId: scope.tenantId, recipientMemberId: scope.recipientMemberId,
      recipientOpenId: scope.recipientOpenId, kind: 'task_action',
      notificationKey: `today-reminder:${occurrence}`, subjectKey: item.id,
      title: '稍后提醒已到期', subtitle: scope.localDate, sections,
      actionLabel: '打开今日行动中心',
      actionUrl: scope.webPublicUrl ? `${scope.webPublicUrl.replace(/\/$/u, '')}/today-actions` : undefined,
      payloadFingerprint: createHash('sha256').update(JSON.stringify({ sections, shortcuts })).digest('hex'),
      shortcuts,
    });
  }
  return messages;
};

export { planDueTodayActionReminders };
