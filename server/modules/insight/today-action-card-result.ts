import type { JsonObject, TodayActionState } from '@shared/api.interface';
import type { ProactiveNotificationMessage } from './proactive-notification-delivery.service';
import { createProactiveNotificationCard } from './proactive-notification.card';

const renderTodayActionCardResult = (
  message: ProactiveNotificationMessage,
  states: TodayActionState[],
): JsonObject => {
  const affected = (message.shortcuts ?? []).filter((shortcut) => states.some((state) =>
    state.itemId === shortcut.value.itemId && state.itemVersion === shortcut.value.itemVersion &&
    state.status !== 'open'));
  const seen: Set<string> = new Set();
  const lines: string[] = [];
  for (const shortcut of affected) {
    const key: string = `${shortcut.value.itemId}:${shortcut.value.itemVersion}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const state = states.find((candidate) => candidate.itemId === shortcut.value.itemId &&
      candidate.itemVersion === shortcut.value.itemVersion);
    const singleItemTitle: string | undefined = message.subjectKey === shortcut.value.itemId &&
      (message.shortcuts ?? []).every((candidate): boolean =>
        candidate.value.itemId === shortcut.value.itemId &&
        candidate.value.itemVersion === shortcut.value.itemVersion)
      ? message.sections[0]?.title : undefined;
    const itemLabel: string = singleItemTitle || shortcut.label.replace(
      / · (?:标记已处理|生成跟进|创建任务|\d{2}\/\d{2} \d{2}:\d{2} 提醒)$/u, '',
    );
    if (state) lines.push(`${itemLabel}：${state.status === 'resolved' ? '已处理' :
      `稍后提醒（${state.remindAt ?? ''}）`}`);
  }
  return createProactiveNotificationCard({ ...message,
    shortcuts: (message.shortcuts ?? []).filter((shortcut) => !affected.includes(shortcut)),
    sections: [...message.sections, ...(lines.length ? [{ title: '处理结果', lines }] : [])],
  });
};

export { renderTodayActionCardResult };
