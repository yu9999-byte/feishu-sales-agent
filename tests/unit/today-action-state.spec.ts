import { expect, it } from 'vitest';
import { transitionTodayAction } from '@server/modules/insight/today-action-state';

it('requires a future reminder time and guards concurrent edits', () => {
  const current = { itemId: 'task:1', itemVersion: 'v1', revision: 0,
    status: 'open' as const, remindAt: null };
  expect(() => transitionTodayAction(current, { itemId: 'task:1', itemVersion: 'v1',
    operation: 'snooze', idempotencyKey: 'key', expectedRevision: 0,
    remindAt: '2026-10-15T00:00:00Z' }, new Date('2026-10-16T00:00:00Z'))).toThrow();
  expect(() => transitionTodayAction(current, { itemId: 'task:1', itemVersion: 'v1',
    operation: 'resolve', idempotencyKey: 'key', expectedRevision: 2 }, new Date())).toThrow();
});

it('resolves only the specified signal version', () => {
  const current = { itemId: 'task:1', itemVersion: 'v1', revision: 0,
    status: 'open' as const, remindAt: null };
  const result = transitionTodayAction(current, { itemId: 'task:1', itemVersion: 'v1',
    operation: 'resolve', idempotencyKey: 'key', expectedRevision: 0 }, new Date());
  expect(result).toMatchObject({ status: 'resolved', revision: 1, itemVersion: 'v1' });
});

it('requires confirmation for business operations instead of changing local state', () => {
  const current = { itemId: 'task:1', itemVersion: 'v1', revision: 0,
    status: 'open' as const, remindAt: null };
  for (const operation of ['generate_followup', 'create_task'] as const) {
    expect(() => transitionTodayAction(current, { itemId: 'task:1', itemVersion: 'v1',
      operation, idempotencyKey: 'key', expectedRevision: 0 }, new Date()))
      .toThrow('CONFIRMATION_FLOW_REQUIRED');
  }
  expect(current.revision).toBe(0);
});

it('snoozes with a canonical timestamp while retaining the exact signal version', () => {
  const current = { itemId: 'task:1', itemVersion: 'v1', revision: 2,
    status: 'open' as const, remindAt: null };
  const result = transitionTodayAction(current, { itemId: 'task:1', itemVersion: 'v1',
    operation: 'snooze', idempotencyKey: 'key', expectedRevision: 2,
    remindAt: '2026-10-17T10:00:00+08:00' }, new Date('2026-10-16T00:00:00Z'));
  expect(result).toMatchObject({ revision: 3, status: 'snoozed',
    remindAt: '2026-10-17T02:00:00.000Z', itemVersion: 'v1' });
  expect(current.status).toBe('open');
});

it('rejects stale signal versions before changing resolution state', () => {
  const current = { itemId: 'task:1', itemVersion: 'v2', revision: 0,
    status: 'open' as const, remindAt: null };
  expect(() => transitionTodayAction(current, { itemId: 'task:1', itemVersion: 'v1',
    operation: 'resolve', idempotencyKey: 'key', expectedRevision: 0 }, new Date()))
    .toThrow('ACTION_CONFLICT');
  expect(current.status).toBe('open');
});

it('rejects blank operation keys before applying a state mutation', () => {
  const current = { itemId: 'task:1', itemVersion: 'v1', revision: 0,
    status: 'open' as const, remindAt: null };
  expect(() => transitionTodayAction(current, { itemId: 'task:1', itemVersion: 'v1',
    operation: 'resolve', idempotencyKey: ' ', expectedRevision: 0 }, new Date()))
    .toThrow('INVALID_IDEMPOTENCY_KEY');
});

it('rejects a reminder timestamp lacking an explicit timezone', () => {
  const current = { itemId: 'task:1', itemVersion: 'v1', revision: 0,
    status: 'open' as const, remindAt: null };
  expect(() => transitionTodayAction(current, { itemId: 'task:1', itemVersion: 'v1',
    operation: 'snooze', idempotencyKey: 'key', expectedRevision: 0,
    remindAt: '2026-10-17T10:00:00' }, new Date('2026-10-16T00:00:00Z')))
    .toThrow('INVALID_REMINDER_TIME');
});

it('rejects malformed reminder dates even when JavaScript normalizes them', () => {
  const current = { itemId: 'task:1', itemVersion: 'v1', revision: 0,
    status: 'open' as const, remindAt: null };
  expect(() => transitionTodayAction(current, { itemId: 'task:1', itemVersion: 'v1',
    operation: 'snooze', idempotencyKey: 'key', expectedRevision: 0,
    remindAt: '2027-02-30T10:00:00Z' }, new Date('2026-10-16T00:00:00Z')))
    .toThrow('INVALID_REMINDER_TIME');
});

it('rejects fractional or negative optimistic revisions', () => {
  for (const revision of [-1, 0.5]) {
    const current = { itemId: 'task:1', itemVersion: 'v1', revision,
      status: 'open' as const, remindAt: null };
    expect(() => transitionTodayAction(current, { itemId: 'task:1', itemVersion: 'v1',
      operation: 'resolve', idempotencyKey: 'key', expectedRevision: revision }, new Date()))
      .toThrow('ACTION_CONFLICT');
  }
});

it('does not resolve a different item sharing the same revision and version', () => {
  const current = { itemId: 'task:1', itemVersion: 'v1', revision: 0,
    status: 'open' as const, remindAt: null };
  expect(() => transitionTodayAction(current, { itemId: 'task:2', itemVersion: 'v1',
    operation: 'resolve', idempotencyKey: 'key', expectedRevision: 0 }, new Date()))
    .toThrow('ACTION_CONFLICT');
});

it('does not allow reminder writes with an invalid reference clock', () => {
  const current = { itemId: 'task:1', itemVersion: 'v1', revision: 0,
    status: 'open' as const, remindAt: null };
  expect(() => transitionTodayAction(current, { itemId: 'task:1', itemVersion: 'v1',
    operation: 'snooze', idempotencyKey: 'key', expectedRevision: 0,
    remindAt: '2027-01-01T00:00:00Z' }, new Date('invalid'))).toThrow();
});

it('does not allow snoozed state without a future reminder after resolution', () => {
  const current = { itemId: 'task:1', itemVersion: 'v1', revision: 1,
    status: 'resolved' as const, remindAt: null };
  expect(() => transitionTodayAction(current, { itemId: 'task:1', itemVersion: 'v1',
    operation: 'snooze', idempotencyKey: 'key', expectedRevision: 1,
    remindAt: '2020-01-01T00:00:00Z' }, new Date())).toThrow('INVALID_REMINDER_TIME');
});
