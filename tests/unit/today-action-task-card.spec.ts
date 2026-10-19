import { expect, it } from 'vitest';
import { parseTodayTaskForm, createTodayTaskCard } from '@server/modules/insight/today-action-task-card';

it('requires explicit valid title and offset-aware deadline before task confirmation', () => {
  expect(() => parseTodayTaskForm({ title: ' ', dueAt: '2026-10-17T09:00:00Z' })).toThrow();
  expect(() => parseTodayTaskForm({ title: '联系客户', dueAt: '2026-10-17 09:00' })).toThrow();
  expect(parseTodayTaskForm({ title: ' 联系客户 ', dueAt: '2026-10-17T09:00:00+08:00',
    participants: '张三、李四', channel: '电话' })).toEqual({ title: '联系客户',
    dueAt: '2026-10-17T01:00:00.000Z', participants: ['张三', '李四'], channel: '电话' });
});

it('renders an editable task-only form with versioned recipient-bound confirmation', () => {
  const card = createTodayTaskCard({ actionId: 'task-one', version: 1, recipientOpenId: 'owner',
    title: '联系客户', dueAt: '2026-10-17T09:00:00Z', channel: '电话', participants: ['张三'] });
  const serialized = JSON.stringify(card);
  expect(serialized).toContain('today_task_confirm');
  expect(serialized).toContain('owner');
  expect(serialized).toContain('确认后创建任务');
  expect(serialized).not.toContain('customerName');
  const limits = [...serialized.matchAll(/"max_length":(\d+)/gu)]
    .map((match) => Number(match[1]));
  expect(limits).toHaveLength(4);
  expect(limits.every((limit) => limit <= 1000)).toBe(true);
});
