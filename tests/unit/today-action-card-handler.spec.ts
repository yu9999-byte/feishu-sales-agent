import { expect, it, vi } from 'vitest';
import { handleTodayActionStateCallback } from '@server/modules/insight/today-action-card-handler';

it('refuses an unowned card before reading data or mutating state', async () => {
  const readVisibleItem = vi.fn();
  const apply = vi.fn();
  await expect(handleTodayActionStateCallback({
    ownsCard: async () => false, readVisibleItem, store: { read: vi.fn(), apply },
  }, { tenantId: 'tenant', memberId: 'member', actorOpenId: 'owner' }, 'card', {
    action: 'today_action', operation: 'resolve', recipientOpenId: 'owner',
    itemId: 'task:1', itemVersion: 'v1', expectedRevision: 0, idempotencyKey: 'key',
  }, new Date())).rejects.toThrow('ACCESS_DENIED');
  expect(readVisibleItem).not.toHaveBeenCalled();
  expect(apply).not.toHaveBeenCalled();
});

it('revalidates the visible signal before applying an owned card operation', async () => {
  const scope = { tenantId: 'tenant', memberId: 'member', actorOpenId: 'owner' };
  const value = { action: 'today_action', operation: 'resolve', recipientOpenId: 'owner',
    itemId: 'task:1', itemVersion: 'v1', expectedRevision: 0, idempotencyKey: 'key' };
  const result = { itemId: 'task:1', itemVersion: 'v1', revision: 1,
    status: 'resolved' as const, remindAt: null };
  const apply = vi.fn().mockResolvedValue(result);
  const readVisibleItem = vi.fn().mockResolvedValue(null);
  const dependencies = { ownsCard: vi.fn().mockResolvedValue(true), readVisibleItem,
    store: { read: vi.fn(), apply } };
  await expect(handleTodayActionStateCallback(dependencies, scope, 'card', value, new Date()))
    .rejects.toThrow('ACTION_CONFLICT');
  expect(apply).not.toHaveBeenCalled();
  readVisibleItem.mockResolvedValue({ itemId: 'task:1', itemVersion: 'v2', revision: 0 });
  await expect(handleTodayActionStateCallback(dependencies, scope, 'card', value, new Date()))
    .rejects.toThrow('ACTION_CONFLICT');
  expect(apply).not.toHaveBeenCalled();
  readVisibleItem.mockResolvedValue({ itemId: 'task:1', itemVersion: 'v1', revision: 0 });
  await expect(handleTodayActionStateCallback(dependencies, scope, 'card', value, new Date()))
    .resolves.toEqual(result);
  expect(apply).toHaveBeenCalledTimes(1);
});
