import { config } from 'dotenv';
import postgres from 'postgres';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { PostgresTodayActionStateStore } from '@server/modules/insight/postgres-today-action-state.store';
import { applyTodayActionCardState, parseTodayActionCardAction } from '@server/modules/insight/today-action-card-contract';
import { PostgresProactiveNotificationStore } from '@server/modules/insight/postgres-proactive-notification.store';
import { todayTaskActionId } from '@server/modules/insight/today-task-action-id';
import { PostgresControlStore } from '@server/modules/control-store/postgres-control.store';
config({ path: '.env.local', quiet: true });
const sql = postgres(process.env.DATABASE_URL!, { max: 4 });
const tenant = '10000000-0000-4000-8000-000000000091';
const member = '20000000-0000-4000-8000-000000000091';
const scope = { tenantId: tenant, memberId: member, actorOpenId: 'ou_today_test' };
const request = { itemId: 'task:1', itemVersion: 'v1', operation: 'resolve' as const,
  expectedRevision: 0, idempotencyKey: 'resolve-1' };

it('accepts deterministic task action IDs in the real UUID control store', async () => {
  const id = todayTaskActionId(tenant, member, 'opportunity:test', 'v1', 'confirm:key');
  expect((await sql`SELECT ${id}::uuid AS id`)[0].id).toBe(id);
  const store = new PostgresControlStore(sql);
  expect(await store.getPendingAction(tenant, id)).toBeNull();
  const action = await store.createPendingAction({ id, tenantId: tenant,
    actorOpenId: scope.actorOpenId, chatId: `web:${member}`,
    expiresAt: new Date('2027-01-01T00:00:00Z'), payload: { version: 1,
      actionKind: 'task', sourceMessageId: 'today-action:integration', rawText: 'test task',
      draft: { customerName: null, contactName: null, opportunityName: null,
        summary: 'test', customerNeeds: [], objections: [], risks: [], progress: null,
        expectedAmount: null, nextAction: 'test task', dueAt: '2026-10-19T06:00:00Z', evidenceQuotes: [] },
    } });
  expect(action.payload.actionKind).toBe('task');
  expect((await new PostgresControlStore(sql).getPendingAction(tenant, id))?.id).toBe(id);
  expect(todayTaskActionId(tenant, member, 'opportunity:test', 'v1', 'confirm:key')).toBe(id);
  expect(todayTaskActionId(tenant, member, 'opportunity:test', 'v2', 'confirm:key')).not.toBe(id);
  expect(todayTaskActionId(tenant, 'other-member', 'opportunity:test', 'v1', 'confirm:key')).not.toBe(id);
});
beforeAll(async () => {
  await sql`INSERT INTO agent_tenants(id,feishu_tenant_key,name,status) VALUES
    (${tenant},'today-action-integration','Today test','active')`;
  await sql`INSERT INTO tenant_members(tenant_id,id,feishu_open_id,display_name,status)
    VALUES (${tenant},${member},'ou_today_test','Today test','active')`;
});
afterAll(async () => { await sql`DELETE FROM agent_tenants WHERE id=${tenant}`; await sql.end(); });
it('persists once under concurrent replay and survives a new store instance', async () => {
  const store = new PostgresTodayActionStateStore(sql);
  const results = await Promise.all([store.apply(scope, request, new Date()), store.apply(scope, request, new Date())]);
  expect(results[0]).toEqual(results[1]);
  expect(results[0].revision).toBe(1);
  expect(await new PostgresTodayActionStateStore(sql).read(scope,'task:1','v1')).toEqual(results[0]);
  await expect(store.apply(scope,{...request,operation:'snooze',remindAt:'2027-01-01T00:00:00Z'},new Date()))
    .rejects.toThrow('IDEMPOTENCY_CONFLICT');
  const rows = await sql`SELECT count(*)::int AS count FROM today_action_operations WHERE tenant_id=${tenant}`;
  expect(rows[0].count).toBe(1);
});

it('reads only due snoozes for the authenticated member without consuming them', async () => {
  const store = new PostgresTodayActionStateStore(sql);
  const start = new Date('2026-10-17T00:00:00Z');
  await store.apply(scope, { ...request, itemId: 'due:1', operation: 'snooze',
    idempotencyKey: 'due:1', remindAt: '2026-10-17T01:00:00Z' }, start);
  await store.apply(scope, { ...request, itemId: 'due:future', operation: 'snooze',
    idempotencyKey: 'due:future', remindAt: '2026-10-18T01:00:00Z' }, start);
  const now = new Date('2026-10-17T02:00:00Z');
  const due = await store.listDue(scope, now);
  expect(due.map((item) => item.itemId)).toEqual(['due:1']);
  expect(await store.listDue({ ...scope, actorOpenId: 'other' }, now)).toEqual([]);
  expect(await store.listDue(scope, now)).toEqual(due);
});

it('isolates member reads and rolls back failed optimistic updates', async () => {
  const store = new PostgresTodayActionStateStore(sql);
  expect(await store.read({ ...scope, actorOpenId: 'ou_other' }, 'task:1', 'v1')).toBeNull();
  await expect(store.apply(scope, { ...request, idempotencyKey: 'stale', expectedRevision: 0 }, new Date()))
    .rejects.toThrow('ACTION_CONFLICT');
  const operations = await sql`SELECT count(*)::int AS count FROM today_action_operations
    WHERE tenant_id=${tenant} AND idempotency_key='stale'`;
  expect(operations[0].count).toBe(0);
  const audit = await sql`SELECT count(*)::int AS count FROM audit_events
    WHERE tenant_id=${tenant} AND event_type='today_action.updated' AND entity_id='task:1'`;
  expect(audit[0].count).toBe(1);
});

it('serializes different operation keys against the same optimistic revision', async () => {
  const store = new PostgresTodayActionStateStore(sql);
  const input = { ...request, itemId: 'task:race' };
  const results = await Promise.allSettled([
    store.apply(scope, { ...input, idempotencyKey: 'race-a' }, new Date()),
    store.apply(scope, { ...input, idempotencyKey: 'race-b' }, new Date()),
  ]);
  expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
  expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
  expect((await store.read(scope, 'task:race', 'v1'))?.revision).toBe(1);
});

it('keeps a new signal version open after resolving the old one', async () => {
  const store = new PostgresTodayActionStateStore(sql);
  expect(await store.read(scope, 'task:1', 'v2')).toBeNull();
  const next = await store.apply(scope, { ...request, itemVersion: 'v2',
    idempotencyKey: 'version-2', operation: 'snooze', remindAt: '2027-01-01T00:00:00Z' }, new Date());
  expect(next.status).toBe('snoozed');
  expect((await store.read(scope, 'task:1', 'v1'))?.status).toBe('resolved');
});

it('replays card state callbacks durably while rejecting new stale clicks', async () => {
  const store = new PostgresTodayActionStateStore(sql);
  const action = parseTodayActionCardAction({ action: 'today_action', operation: 'resolve',
    itemId: 'task:card', itemVersion: 'v1', expectedRevision: 0,
    recipientOpenId: scope.actorOpenId, idempotencyKey: 'card-resolve' });
  const item = { itemId: action.itemId, itemVersion: action.itemVersion, revision: 0 };
  const first = await applyTodayActionCardState(store, scope, action, item, new Date());
  expect(await applyTodayActionCardState(new PostgresTodayActionStateStore(sql), scope,
    action, { ...item, revision: 1 }, new Date())).toEqual(first);
  await expect(applyTodayActionCardState(store, scope,
    { ...action, idempotencyKey: 'card-stale' }, { ...item, revision: 1 }, new Date()))
    .rejects.toThrow('ACTION_CONFLICT');
  const operations = await sql`SELECT count(*)::int AS count FROM today_action_operations
    WHERE tenant_id=${tenant} AND item_id='task:card'`;
  expect(operations[0].count).toBe(1);
});

it('binds a shortcut callback to the sent card and its active recipient', async () => {
  const notifications = new PostgresProactiveNotificationStore(sql);
  const now = new Date();
  const claim = await notifications.claim({ tenantId: tenant, recipientMemberId: member,
    recipientOpenId: scope.actorOpenId, kind: 'task_action', notificationKey: 'card-binding',
    subjectKey: 'today', payloadFingerprint: 'binding', now, claimDurationMs: 60000, maxAttempts: 3 });
  if (claim.status !== 'claimed') throw new Error('Expected notification claim');
  const state = { tenantId: tenant, recipientMemberId: member, kind: 'task_action' as const,
    notificationKey: 'card-binding', claimToken: claim.claimToken };
  await notifications.markDispatchStarted({ ...state, startedAt: now });
  const input = { ...scope, messageId: 'om_today_card' };
  expect(await notifications.ownsSentCard(input)).toBe(false);
  await notifications.markSent({ ...state, messageId: input.messageId, sentAt: now });
  expect(await notifications.ownsSentCard(input)).toBe(true);
  expect(await notifications.ownsSentCard({ ...input, actorOpenId: 'other' })).toBe(false);
  expect(await notifications.ownsSentCard({ ...input, messageId: 'om_other' })).toBe(false);
  const callback = { action: 'today_action', operation: 'resolve', recipientOpenId: scope.actorOpenId,
    itemId: 'task:bound', itemVersion: 'v1', expectedRevision: 0, idempotencyKey: 'bound-key' };
  expect(await notifications.ownsSentCard({ ...input, callback })).toBe(false);
  await sql`UPDATE proactive_sales_notifications SET message_payload=${JSON.stringify({
    shortcuts: [{ label: '处理', value: callback }],
  })}::text::jsonb WHERE tenant_id=${tenant} AND notification_key='card-binding'`;
  expect(await notifications.ownsSentCard({ ...input, callback })).toBe(true);
  expect(await notifications.readSentCard(input)).toEqual({
    shortcuts: [{ label: '处理', value: callback }],
  });
  expect(await notifications.readSentCard({ ...input, actorOpenId: 'other' })).toBeNull();
  expect(await notifications.readSentCard({ ...input, messageId: 'om_other' })).toBeNull();
  expect(await notifications.ownsSentCard({ ...input,
    callback: { ...callback, itemId: 'task:forged' } })).toBe(false);
  expect(await notifications.ownsSentCard({ ...input,
    callback: { ...callback, operation: 'snooze', remindAt: '2027-01-01T00:00:00Z' } })).toBe(false);
});
