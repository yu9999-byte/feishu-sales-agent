import { expect, it } from 'vitest';
import { assertTodayActionCardScope, parseTodayActionCardAction, applyTodayActionCardState } from '@server/modules/insight/today-action-card-contract';
import { vi } from 'vitest';

const payload = {
  action: 'today_action', operation: 'snooze', itemId: 'task:1',
  itemVersion: 'v1', expectedRevision: 0, recipientOpenId: 'ou_owner',
  idempotencyKey: 'card-operation-1', remindAt: '2026-10-17T01:00:00Z',
};

it('retains stable reminder time and operation key across callback replays', () => {
  expect(parseTodayActionCardAction(payload)).toEqual(payload);
  expect(parseTodayActionCardAction(JSON.parse(JSON.stringify(payload)))).toEqual(payload);
});

it('uses the authenticated tenant scope and durable ledger for state callbacks', async () => {
  const action = parseTodayActionCardAction(payload);
  const next = { itemId: 'task:1', itemVersion: 'v1', revision: 1,
    status: 'snoozed' as const, remindAt: payload.remindAt };
  const store = { read: vi.fn(), apply: vi.fn().mockResolvedValue(next) };
  const scope = { tenantId: 'tenant', memberId: 'member', actorOpenId: 'ou_owner' };
  const item = { itemId: 'task:1', itemVersion: 'v1', revision: 0 };
  const now = new Date('2026-10-16T01:00:00Z');
  expect(await applyTodayActionCardState(store, scope, action, item, now)).toEqual(next);
  expect(store.apply).toHaveBeenCalledWith(scope, {
    itemId: 'task:1', itemVersion: 'v1', expectedRevision: 0,
    operation: 'snooze', idempotencyKey: payload.idempotencyKey,
    remindAt: payload.remindAt,
  }, now);
  await expect(applyTodayActionCardState(store, { ...scope, actorOpenId: 'other' }, action, item, now))
    .rejects.toThrow('ACCESS_DENIED');
  expect(store.apply).toHaveBeenCalledTimes(1);
});

it('lets a duplicate callback reach the durable replay ledger after revision changes', async () => {
  const action = parseTodayActionCardAction(payload);
  const result = { itemId: 'task:1', itemVersion: 'v1', revision: 1,
    status: 'snoozed' as const, remindAt: payload.remindAt };
  const store = { read: vi.fn(), apply: vi.fn().mockResolvedValue(result) };
  await expect(applyTodayActionCardState(store,
    { tenantId: 'tenant', memberId: 'member', actorOpenId: 'ou_owner' }, action,
    { itemId: 'task:1', itemVersion: 'v1', revision: 1 }, new Date()))
    .resolves.toEqual(result);
  expect(store.apply).toHaveBeenCalledTimes(1);
});

it('rejects malformed actions, revisions and unbound recipients', () => {
  for (const patch of [
    { operation: 'execute' }, { expectedRevision: -1 },
    { recipientOpenId: '' }, { itemVersion: '' }, { idempotencyKey: '' },
    { remindAt: 'tomorrow' }, { unexpected: true },
  ]) {
    expect(() => parseTodayActionCardAction({ ...payload, ...patch })).toThrow();
  }
});

it('requires an explicit reminder timestamp only for snooze', () => {
  expect(() => parseTodayActionCardAction({ ...payload, remindAt: undefined })).toThrow();
  expect(parseTodayActionCardAction({ ...payload, operation: 'resolve', remindAt: undefined }))
    .toMatchObject({ operation: 'resolve' });
});

it('never applies business operations through the local state ledger', async () => {
  const store = { read: vi.fn(), apply: vi.fn() };
  const scope = { tenantId: 'tenant', memberId: 'member', actorOpenId: 'ou_owner' };
  const item = { itemId: 'task:1', itemVersion: 'v1', revision: 0 };
  for (const operation of ['generate_followup', 'create_task']) {
    const action = parseTodayActionCardAction({ ...payload, operation, remindAt: undefined });
    await expect(applyTodayActionCardState(store, scope, action, item, new Date()))
      .rejects.toThrow('CONFIRMATION_FLOW_REQUIRED');
  }
  expect(store.apply).not.toHaveBeenCalled();
});

it('rejects forwarded cards and stale signal revisions before any operation', () => {
  const action = parseTodayActionCardAction(payload);
  const scope = { operatorOpenId: 'ou_owner', itemId: 'task:1', itemVersion: 'v1', revision: 0 };
  expect(() => assertTodayActionCardScope(action, scope)).not.toThrow();
  for (const patch of [{ operatorOpenId: 'ou_other' }, { itemId: 'task:2' },
    { itemVersion: 'v2' }, { revision: 1 }]) {
    expect(() => assertTodayActionCardScope(action, { ...scope, ...patch })).toThrow();
  }
});
