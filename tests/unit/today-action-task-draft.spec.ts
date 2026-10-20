import { expect, it, vi } from 'vitest';
import { openTodayTaskDraft } from '@server/modules/insight/today-action-task-draft';
import type { CreatePendingActionInput, PendingAction } from '@server/modules/agent-core/agent.types';
import { testIntegration } from '../fixtures/tenant-integration';
import type { TodayActionViewItem } from '@shared/api.interface';

it('recovers a card-binding failure using the same pending action and skips already bound cards', async () => {
  let pending: PendingAction | null = null;
  const create = vi.fn(async (input: CreatePendingActionInput): Promise<PendingAction> => {
    pending = { ...input, status: 'pendingConfirmation', cardMessageId: null,
      result: { pendingActionId: input.id, status: 'pendingConfirmation' },
      createdAt: new Date(), updatedAt: new Date() };
    return pending;
  });
  const control = { getPendingAction: vi.fn(async () => pending), createPendingAction: create,
    setPendingCardMessage: vi.fn().mockRejectedValueOnce(new Error('database unavailable')).mockResolvedValue(undefined) };
  const messenger = { sendConfirmationCard: vi.fn().mockResolvedValue('same-card') };
  const now = new Date();
  const item: TodayActionViewItem = {
    id: 'task:1', version: 'v1', reason: '任务逾期', suggestedAction: '联系客户',
    kind: 'task', sourceId: '1', customerRecordId: null, title: '联系客户',
    evidence: ['任务已逾期'], suggestedCompletionDate: '2026-10-20', sourceUrl: null,
    state: { itemId: 'task:1', itemVersion: 'v1', revision: 0, status: 'open', remindAt: null },
  };
  const input = { memberId: 'member', actorOpenId: 'owner', chatId: 'chat', messageId: 'digest', item, now };
  await expect(openTodayTaskDraft(control, messenger, testIntegration, input)).rejects.toThrow('database unavailable');
  await openTodayTaskDraft(control, messenger, testIntegration, input);
  expect(create).toHaveBeenCalledOnce();
  expect(create.mock.calls[0][0].id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u);
  expect(messenger.sendConfirmationCard.mock.calls[0][2].id)
    .toBe(messenger.sendConfirmationCard.mock.calls[1][2].id);
  expect(messenger.sendConfirmationCard.mock.calls[0][2].payload.draft.dueAt).toBeNull();
  pending = { ...messenger.sendConfirmationCard.mock.calls[0][2], cardMessageId: 'same-card' };
  await openTodayTaskDraft(control, messenger, testIntegration, input);
  expect(messenger.sendConfirmationCard).toHaveBeenCalledTimes(2);
});
