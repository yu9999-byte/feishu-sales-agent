import { expect, it } from 'vitest';
import { planDueTodayActionReminders } from '@server/modules/insight/today-action-reminder-planner';

it('plans only due visible versions with a stable revision occurrence key', () => {
  const item = { id: 'task:1', version: 'v1', kind: 'task' as const, sourceId: '1',
    customerRecordId: null, title: '联系客户', reason: '任务已逾期', evidence: ['昨天截止'],
    suggestedAction: '电话确认', suggestedCompletionDate: '2026-10-17', sourceUrl: null,
    state: { itemId: 'task:1', itemVersion: 'v1', revision: 0, status: 'open' as const, remindAt: null } };
  const state = { itemId: 'task:1', itemVersion: 'v1', revision: 3,
    status: 'snoozed' as const, remindAt: '2026-10-17T01:00:00Z' };
  const scope = { tenantId: 'tenant', recipientMemberId: 'member', recipientOpenId: 'owner',
    localDate: '2026-10-17', timezone: 'Asia/Shanghai' };
  const now = new Date('2026-10-17T02:00:00Z');
  const planned = planDueTodayActionReminders(scope, [item], [state], now);
  expect(planned).toHaveLength(1);
  expect(planned[0].shortcuts?.[0].value.expectedRevision).toBe(3);
  expect(planned[0].shortcuts?.map((shortcut) => shortcut.value.operation)).toEqual([
    'resolve', 'generate_followup', 'create_task', 'snooze',
  ]);
  expect(planned[0].shortcuts?.[3].value.remindAt).toBe('2026-10-17T03:00:00.000Z');
  expect(JSON.stringify(planned[0])).toContain('昨天截止');
  expect(planDueTodayActionReminders(scope, [item], [state], now)).toEqual(planned);
  expect(planDueTodayActionReminders(scope, [item], [{ ...state, itemVersion: 'old' }], now)).toEqual([]);
  expect(planDueTodayActionReminders(scope, [item], [{ ...state, remindAt: '2026-10-18T01:00:00Z' }], now)).toEqual([]);
  expect(planDueTodayActionReminders(scope, [item], [{ ...state, status: 'resolved' }], now)).toEqual([]);
  expect(planDueTodayActionReminders(scope, [item], [{ ...state, revision: 4 }], now)[0].notificationKey)
    .not.toBe(planned[0].notificationKey);
});
