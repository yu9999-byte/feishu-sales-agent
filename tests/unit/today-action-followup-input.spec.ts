import { expect, it, vi } from 'vitest';
import { openTodayFollowupInput } from '@server/modules/insight/today-action-followup-input';

it('uses a stable draft and patches the original card without treating suggestions as communication', async () => {
  const create = vi.fn(async (input) => ({ ...input, status: 'pendingConfirmation',
    cardMessageId: null, result: {}, createdAt: new Date(), updatedAt: new Date() }));
  const control = { getPendingAction: vi.fn().mockResolvedValue(null), createPendingAction: create,
    setPendingCardMessage: vi.fn() };
  const messenger = { updateCard: vi.fn(), sendConfirmationCard: vi.fn().mockResolvedValue('confirmation') };
  const input = { tenantId: 'tenant', memberId: 'member', actorOpenId: 'owner',
    chatId: 'chat', messageId: 'card', itemId: 'one', itemVersion: 'v1', now: new Date() };
  await openTodayFollowupInput(control, messenger, { tenantId: 'tenant' }, input);
  expect(create.mock.calls[0][0].payload.rawText).toBe('');
  expect(create.mock.calls[0][0].id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u);
  expect(create.mock.calls[0][0].payload.interactionStage).toBe('input');
  expect(messenger.sendConfirmationCard).toHaveBeenCalledOnce();
  expect(control.setPendingCardMessage.mock.calls[0][2]).toBe('confirmation');
  expect(messenger.updateCard).not.toHaveBeenCalled();
});

it('refuses a foreign or already executed draft before patching its card', async () => {
  const base = { id: 'existing', tenantId: 'tenant', actorOpenId: 'other', chatId: 'chat',
    status: 'succeeded', expiresAt: new Date(Date.now() + 60000) };
  const control = { getPendingAction: vi.fn().mockResolvedValue(base),
    createPendingAction: vi.fn(), setPendingCardMessage: vi.fn() };
  const messenger = { updateCard: vi.fn(), sendConfirmationCard: vi.fn().mockResolvedValue('confirmation') };
  const input = { tenantId: 'tenant', memberId: 'member', actorOpenId: 'owner',
    chatId: 'chat', messageId: 'card', itemId: 'one', itemVersion: 'v1', now: new Date() };
  await expect(openTodayFollowupInput(control, messenger, { tenantId: 'tenant' }, input))
    .rejects.toThrow('ACCESS_DENIED');
  control.getPendingAction.mockResolvedValue({ ...base, actorOpenId: 'owner' });
  await expect(openTodayFollowupInput(control, messenger, { tenantId: 'tenant' }, input))
    .rejects.toThrow('ACTION_CONFLICT');
  expect(control.createPendingAction).not.toHaveBeenCalled();
  expect(messenger.updateCard).not.toHaveBeenCalled();
});


it('does not overwrite an already bound input card on a duplicate callback', async () => {
  const now = new Date();
  const pending = { id: 'existing', tenantId: 'tenant', actorOpenId: 'owner', chatId: 'chat',
    status: 'pendingConfirmation', expiresAt: new Date(now.getTime() + 60000),
    cardMessageId: 'input-card', payload: { interactionStage: 'input' } };
  const control = { getPendingAction: vi.fn().mockResolvedValue(pending),
    createPendingAction: vi.fn(), setPendingCardMessage: vi.fn() };
  const messenger = { updateCard: vi.fn(), sendConfirmationCard: vi.fn() };
  await openTodayFollowupInput(control, messenger, { tenantId: 'tenant' }, {
    tenantId: 'tenant', memberId: 'member', actorOpenId: 'owner', chatId: 'chat',
    messageId: 'digest', itemId: 'one', itemVersion: 'v1', now });
  expect(control.createPendingAction).not.toHaveBeenCalled();
  expect(messenger.sendConfirmationCard).not.toHaveBeenCalled();
  expect(messenger.updateCard).not.toHaveBeenCalled();
});
