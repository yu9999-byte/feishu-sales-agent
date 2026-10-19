import { expect, it, vi } from 'vitest';
import { confirmTodayTaskCard } from '@server/modules/insight/today-action-task-confirmation';

it('rejects forged card ownership before acquiring a task execution lease', async () => {
  const control = { getPendingAction: vi.fn().mockResolvedValue(null), acquirePendingAction: vi.fn() };
  const executor = { schedule: vi.fn() };
  const incoming = { value: { action: 'today_task_confirm', actionId: 'one', version: 1,
    recipientOpenId: 'owner' }, operatorOpenId: 'owner', cardMessageId: 'card', chatId: 'chat',
    receivedAt: new Date(), formValue: {} };
  await expect(confirmTodayTaskCard(control, executor, { tenantId: 'tenant' }, incoming))
    .rejects.toThrow('ACCESS_DENIED');
  expect(control.acquirePendingAction).not.toHaveBeenCalled();
  expect(executor.schedule).not.toHaveBeenCalled();
});

it('replays an executing task without parsing stale form data or scheduling it again', async () => {
  const pending = { id: 'one', actorOpenId: 'owner', chatId: 'chat', cardMessageId: 'card',
    status: 'executing', payload: { actionKind: 'task', draftVersion: 1 } };
  const control = { getPendingAction: vi.fn().mockResolvedValue(pending), acquirePendingAction: vi.fn() };
  const executor = { schedule: vi.fn() };
  const incoming = { value: { action: 'today_task_confirm', actionId: 'one', version: 1,
    recipientOpenId: 'owner' }, operatorOpenId: 'owner', cardMessageId: 'card', chatId: 'chat',
    receivedAt: new Date(), formValue: {} };
  await expect(confirmTodayTaskCard(control, executor, { tenantId: 'tenant' }, incoming)).resolves.toBe('executing');
  expect(control.acquirePendingAction).not.toHaveBeenCalled();
  expect(executor.schedule).not.toHaveBeenCalled();
});

it('passes the edited task fields and expected version into the atomic execution lease', async () => {
  const now = new Date();
  const pending = { id: 'one', actorOpenId: 'owner', chatId: 'chat', cardMessageId: 'card',
    status: 'pendingConfirmation', expiresAt: new Date(now.getTime() + 60000),
    payload: { actionKind: 'task', draftVersion: 1, draft: { nextAction: 'old' } } };
  const control = { getPendingAction: vi.fn().mockResolvedValue(pending),
    acquirePendingAction: vi.fn().mockResolvedValue({ ...pending, status: 'executing' }) };
  const executor = { schedule: vi.fn() };
  const incoming = { value: { action: 'today_task_confirm', actionId: 'one', version: 1,
    recipientOpenId: 'owner' }, operatorOpenId: 'owner', cardMessageId: 'card', chatId: 'chat',
    receivedAt: now, formValue: { title: '编辑后的任务', dueAt: '2026-10-18T09:00:00+08:00', channel: '电话' } };
  await expect(confirmTodayTaskCard(control, executor, { tenantId: 'tenant' }, incoming)).resolves.toBe('executing');
  const lease = control.acquirePendingAction.mock.calls[0];
  expect(lease[5].draft.nextAction).toBe('编辑后的任务');
  expect(lease[5].draft.dueAt).toBe('2026-10-18T01:00:00.000Z');
  expect(lease[6]).toBe(1);
  expect(executor.schedule).toHaveBeenCalledOnce();
  executor.schedule.mockClear();
  control.acquirePendingAction.mockResolvedValue(null);
  await expect(confirmTodayTaskCard(control, executor, { tenantId: 'tenant' }, incoming)).rejects.toThrow('ACTION_CONFLICT');
  expect(executor.schedule).not.toHaveBeenCalled();
});
