import { createHash } from 'node:crypto';
import type { TodayActionViewItem } from '@shared/api.interface';
import type { ProactiveNotificationMessage } from './proactive-notification-delivery.service';
import type { ProactiveNotificationPlanScope } from './proactive-notification-planner.service';

const planTodayActionDigest = (
  scope: ProactiveNotificationPlanScope,
  items: TodayActionViewItem[],
  warnings: string[],
): ProactiveNotificationMessage | null => {
  const visible = items.filter((item) => item.state.status === 'open');
  if (!visible.length) return null;
  const sections = visible.slice(0, 8).map((item) => ({ title: item.title, lines: [
    `提醒原因：${item.reason}`, `判断证据：${item.evidence.join('；')}`,
    `建议动作：${item.suggestedAction}`, `建议完成时间：${item.suggestedCompletionDate}`,
  ] }));
  if (warnings.length) sections.push({ title: '来源覆盖', lines: warnings.slice(0, 5) });
  const shortcuts = visible.slice(0, 2).flatMap((item) => {
    const value = { action: 'today_action' as const, recipientOpenId: scope.recipientOpenId,
      itemId: item.id, itemVersion: item.version, expectedRevision: item.state.revision };
    const key: string = `digest:${scope.localDate}:${item.id}:${item.version}:${item.state.revision}`;
    return [{ label: `${item.title.slice(0, 65)} · 标记已处理`,
      value: { ...value, operation: 'resolve' as const, idempotencyKey: `${key}:resolve` } },
    { label: `${item.title.slice(0, 65)} · 生成跟进`,
      value: { ...value, operation: 'generate_followup' as const, idempotencyKey: `${key}:followup` } },
    { label: `${item.title.slice(0, 65)} · 创建任务`,
      value: { ...value, operation: 'create_task' as const, idempotencyKey: `${key}:task` } },
    ...(scope.now ? [{ label: `${item.title.slice(0, 45)} · ${new Intl.DateTimeFormat('zh-CN', {
      timeZone: scope.timezone, month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
      hour12: false,
    }).format(new Date(scope.now.getTime() + 3600000))} 提醒`, value: { ...value,
      operation: 'snooze' as const, idempotencyKey: `${key}:snooze`,
      remindAt: new Date(scope.now.getTime() + 3600000).toISOString() } }] : [])];
  });
  return { tenantId: scope.tenantId, recipientMemberId: scope.recipientMemberId,
    recipientOpenId: scope.recipientOpenId, kind: 'task_action', notificationKey: scope.localDate,
    subjectKey: 'today-action-digest', title: '今日行动提醒',
    subtitle: `${visible.length} 个事项需要关注 · ${scope.localDate}${visible.length > 8 ? ' · 更多事项请打开工作台' : ''}`,
    sections, shortcuts, actionLabel: '打开今日行动中心',
    actionUrl: scope.webPublicUrl ? `${scope.webPublicUrl.replace(/\/$/u, '')}/today-actions` : undefined,
    payloadFingerprint: createHash('sha256').update(JSON.stringify({ sections, shortcuts })).digest('hex') };
};

export { planTodayActionDigest };
