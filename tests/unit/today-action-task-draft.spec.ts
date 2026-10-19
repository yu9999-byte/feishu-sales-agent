import { expect, it, vi } from 'vitest';
import { openTodayTaskDraft } from '@server/modules/insight/today-action-task-draft';

it('recovers a card-binding failure using the same pending action and skips already bound cards', async () => {
  let pending: unknown = null;
  const create = vi.fn(async (input) => {
    pending = { ...input, status: 'pendingConfirmation', cardMessageId: null };
    return pending;
  });
  const control = { getPendingAction: vi.fn(async () => pending), createPendingAction: create,
    setPendingCardMessage: vi.fn().mockRejectedValueOnce(new Error('database unavailable')).mockResolvedValue(undefined) };
  const messenger = { sendConfirmationCard: vi.fn().mockResolvedValue('same-card') };
  const now = new Date();
  const item = { id: 'task:1', version: 'v1', reason: '任务逾期', suggestedAction: '联系客户' };
  const input = { memberId: 'member', actorOpenId: 'owner', chatId: 'chat', messageId: 'digest', item, now };
  await expect(openTodayTaskDraft(control, messenger, { tenantId: 'tenant' }, input)).rejects.toThrow('database unavailable');
  await openTodayTaskDraft(control, messenger, { tenantId: 'tenant' }, input);
  expect(create).toHaveBeenCalledOnce();
  expect(create.mock.calls[0][0].id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u);
  expect(messenger.sendConfirmationCard.mock.calls[0][2].id)
    .toBe(messenger.sendConfirmationCard.mock.calls[1][2].id);
  expect(messenger.sendConfirmationCard.mock.calls[0][2].payload.draft.dueAt).toBeNull();
  pending = { ...messenger.sendConfirmationCard.mock.calls[0][2], cardMessageId: 'same-card' };
  await openTodayTaskDraft(control, messenger, { tenantId: 'tenant' }, input);
  expect(messenger.sendConfirmationCard).toHaveBeenCalledTimes(2);
});
