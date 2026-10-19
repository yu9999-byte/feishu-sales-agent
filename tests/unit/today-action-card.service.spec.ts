import { expect, it, vi } from 'vitest';
import { TodayActionCardService } from '@server/modules/insight/today-action-card.service';
import type { ControlStore } from '@server/modules/agent-core/agent.ports';
import type { IncomingCardAction } from '@server/modules/agent-core/agent.types';
import type { PlatformSessionService } from '@server/modules/platform-shell/platform-session.service';
import type { PostgresProactiveNotificationStore } from '@server/modules/insight/postgres-proactive-notification.store';
import type { PostgresTodayActionStateStore } from '@server/modules/insight/postgres-today-action-state.store';
import type { TodayActionService } from '@server/modules/insight/today-action.service';
import type { FeishuMessengerService } from '@server/modules/feishu/feishu-messenger.service';

const harness = () => {
  const value = { action: 'today_action', operation: 'resolve', recipientOpenId: 'owner',
    itemId: 'task:1', itemVersion: 'v1', expectedRevision: 0, idempotencyKey: 'one' };
  const state = { itemId: 'task:1', itemVersion: 'v1', revision: 1, status: 'resolved', remindAt: null };
  const control = { resolveTenant: vi.fn().mockResolvedValue({ tenantId: 'tenant', status: 'active' }) };
  const sessions = { getActiveMember: vi.fn().mockResolvedValue({ id: 'member' }),
    getSessionByMembership: vi.fn().mockResolvedValue({ tenant: { timezone: 'Asia/Shanghai' },
      permissions: ['customer:read', 'opportunity:read', 'task:read'] }) };
  const notifications = { ownsSentCard: vi.fn().mockResolvedValue(true),
    readSentCard: vi.fn().mockResolvedValue({ tenantId: 'tenant', recipientMemberId: 'member',
      recipientOpenId: 'owner', kind: 'task_action', notificationKey: 'day', subjectKey: 'tasks',
      title: '行动', subtitle: '今日', sections: [], payloadFingerprint: 'hash',
      shortcuts: [{ label: '处理', value }] }) };
  const states = { apply: vi.fn().mockResolvedValue(state), read: vi.fn().mockResolvedValue(state) };
  const actions = { analyze: vi.fn().mockResolvedValue({ items: [{ id: 'task:1', version: 'v1', state }] }) };
  const messenger = { updateCard: vi.fn().mockResolvedValue(undefined) };
  const service = new TodayActionCardService(control as unknown as ControlStore,
    sessions as unknown as PlatformSessionService,
    notifications as unknown as PostgresProactiveNotificationStore,
    states as unknown as PostgresTodayActionStateStore,
    actions as unknown as TodayActionService, messenger as unknown as FeishuMessengerService);
  const incoming: IncomingCardAction = { feishuTenantKey: 'key', eventId: 'event',
    operatorOpenId: 'owner', callbackToken: 'token', cardMessageId: 'card', chatId: 'chat',
    actionName: null, value, formValue: {}, receivedAt: new Date() };
  return { service, incoming, control, sessions, notifications, states, actions, messenger };
};

it('blocks inactive membership and missing permission before reading or writing action data', async () => {
  const h = harness();
  h.sessions.getActiveMember.mockResolvedValueOnce(null);
  expect(JSON.stringify(await h.service.handle(h.incoming))).toContain('无权操作');
  h.sessions.getSessionByMembership.mockResolvedValueOnce({ tenant: { timezone: 'Asia/Shanghai' },
    permissions: ['task:read'] });
  expect(JSON.stringify(await h.service.handle(h.incoming))).toContain('无权操作');
  expect(h.actions.analyze).not.toHaveBeenCalled();
  expect(h.states.apply).not.toHaveBeenCalled();
  expect(h.messenger.updateCard).not.toHaveBeenCalled();
});

it('recovers a failed original-card refresh with the same durable operation key', async () => {
  const h = harness();
  h.messenger.updateCard.mockRejectedValueOnce(new Error('patch failed'));
  expect(JSON.stringify(await h.service.handle(h.incoming))).toContain('操作已保存');
  expect(JSON.stringify(await h.service.handle(h.incoming))).toContain('已标记处理');
  expect(h.states.apply.mock.calls.map((call) => call[1].idempotencyKey)).toEqual(['one', 'one']);
  expect(h.messenger.updateCard).toHaveBeenCalledTimes(2);
  expect(h.messenger.updateCard.mock.calls[0][1]).toBe('card');
  expect(h.messenger.updateCard.mock.calls[1][2]).toEqual(h.messenger.updateCard.mock.calls[0][2]);
});
