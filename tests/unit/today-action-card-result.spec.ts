import { expect, it } from 'vitest';
import { renderTodayActionCardResult } from '@server/modules/insight/today-action-card-result';
import type { ProactiveNotificationMessage } from '@server/modules/insight/proactive-notification-delivery.service';
import { planDueTodayActionReminders } from '@server/modules/insight/today-action-reminder-planner';

it('uses the frozen item title for short buttons in due reminder results', () => {
  const state = { itemId: 'task:1', itemVersion: 'v1', revision: 1,
    status: 'snoozed' as const, remindAt: '2026-10-19T01:00:00Z' };
  const messages = planDueTodayActionReminders({ tenantId: 'tenant', recipientMemberId: 'member',
    recipientOpenId: 'owner', localDate: '2026-10-19', timezone: 'Asia/Shanghai' }, [{
    id: 'task:1', sourceId: '1', version: 'v1', kind: 'task', customerRecordId: null,
    title: '核实试点预算', reason: '任务逾期', evidence: ['客户约定昨天核实'],
    suggestedAction: '电话核实', suggestedCompletionDate: '2026-10-19', sourceUrl: null, state,
  }], [state], new Date('2026-10-19T02:00:00Z'));
  const message = messages[0];
  const resolved = { ...state, revision: 2, status: 'resolved' as const, remindAt: null };
  expect(JSON.stringify(renderTodayActionCardResult(message, [resolved])))
    .toContain('核实试点预算：已处理');
  const mixed = { ...message, shortcuts: [...message.shortcuts!, {
    ...message.shortcuts![0], value: { ...message.shortcuts![0].value, itemId: 'task:2' },
  }] };
  expect(JSON.stringify(renderTodayActionCardResult(mixed, [resolved])))
    .not.toContain('核实试点预算：已处理');
});

it.each(['标记已处理', '生成跟进', '创建任务', '10/18 19:45 提醒'])(
  'shows the item and actual snooze state when the first shortcut is %s', (operation: string) => {
    const label: string = `试点 · 金额核实 · ${operation}`;
    const message: ProactiveNotificationMessage = {
      tenantId: 'tenant', recipientMemberId: 'member', recipientOpenId: 'owner',
      kind: 'task_action', notificationKey: 'day', subjectKey: 'tasks',
      title: '今日行动', subtitle: '提醒', sections: [], payloadFingerprint: 'hash',
      shortcuts: [{ label, value: { action: 'today_action', operation: 'resolve',
        recipientOpenId: 'owner', itemId: 'task:1', itemVersion: 'v1',
        expectedRevision: 0, idempotencyKey: 'one' } }],
    };
    const card: string = JSON.stringify(renderTodayActionCardResult(message, [{
      itemId: 'task:1', itemVersion: 'v1', revision: 1, status: 'snoozed',
      remindAt: '2026-10-18T11:45:00.000Z',
    }]));
    expect(card).toContain('试点 · 金额核实：稍后提醒（');
    expect(card).toContain('2026-10-18T11&#58;45&#58;00.000Z');
    expect(card).not.toContain(label);
  },
);

it('rebuilds the original card from current states without losing other actions', () => {
  const value = { action: 'today_action' as const, operation: 'resolve' as const,
    recipientOpenId: 'owner', itemId: 'task:1', itemVersion: 'v1',
    expectedRevision: 0, idempotencyKey: 'one' };
  const message = { tenantId: 'tenant', recipientMemberId: 'member', recipientOpenId: 'owner',
    kind: 'task_action' as const, notificationKey: 'day', subjectKey: 'tasks',
    title: '今日行动', subtitle: '提醒', sections: [{ title: '待办', lines: ['客户沟通'] }],
    payloadFingerprint: 'hash', shortcuts: [{ label: 'first', value },
      { label: 'second', value: { ...value, itemId: 'task:2', idempotencyKey: 'two' } }] };
  const states = [{ itemId: 'task:1', itemVersion: 'v1', revision: 1,
    status: 'resolved' as const, remindAt: null }];
  const card = renderTodayActionCardResult(message, states);
  expect(JSON.stringify(card)).not.toContain('"content":"first"');
  expect(JSON.stringify(card)).toContain('second');
  expect(JSON.stringify(card)).toContain('已处理');
  expect(JSON.stringify(card)).toContain('客户沟通');
  expect(renderTodayActionCardResult(message, states)).toEqual(card);
  expect(JSON.stringify(renderTodayActionCardResult(message,
    [{ ...states[0], itemVersion: 'new' }]))).toContain('"content":"first"');
});
