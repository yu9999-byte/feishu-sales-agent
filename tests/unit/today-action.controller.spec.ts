import { expect, it, vi } from 'vitest';
import { TodayActionController } from '@server/modules/insight/today-action.controller';
import { PlatformAccessDeniedError } from '@server/modules/platform-shell/platform-session.service';

it.each(['succeeded', 'executing', 'cancelled', 'expired'])('preserves %s task status on repeated confirmation', async (status) => {
  const auth = { publicOrigin: 'https://sales.example', authenticateSession: vi.fn().mockResolvedValue({
    tenantId: 't', member: { id: 'm', feishuOpenId: 'actor' },
  }) };
  const action = { id: 'task', actorOpenId: 'actor', status,
    payload: { actionKind: 'task' }, result: { taskGuid: 'original-task' } };
  const store = { getPendingAction: vi.fn().mockResolvedValue(action),
    resolveTenantById: vi.fn().mockResolvedValue({ tenantId: 't', status: 'active' }),
    acquirePendingAction: vi.fn().mockResolvedValue(null) };
  const executor = { schedule: vi.fn() };
  const controller = new TodayActionController(auth as never, { assertPermission: vi.fn() } as never,
    {} as never, {} as never, store as never, undefined, undefined, executor as never);
  const result = controller.confirmTaskDraft({ headers: { origin: auth.publicOrigin,
    cookie: 'sales-agent-session=x' } } as never, {}, 'task');
  if (status === 'succeeded' || status === 'executing') {
    await expect(result).resolves.toMatchObject({ status, taskGuid: 'original-task' });
  } else {
    await expect(result).rejects.toMatchObject({ status: 409 });
  }
  expect(store.acquirePendingAction).not.toHaveBeenCalled();
  expect(executor.schedule).not.toHaveBeenCalled();
});

it('creates a standalone task draft without scheduling or writing a task', async () => {
  const auth = { publicOrigin: 'https://sales.example', authenticateSession: vi.fn().mockResolvedValue({
    tenantId: 't', member: { id: 'm', feishuOpenId: 'actor' },
  }) };
  const shell = { assertPermission: vi.fn().mockResolvedValue(undefined) };
  const sessions = { getSessionByMembership: vi.fn().mockResolvedValue({ tenant: { timezone: 'Asia/Shanghai' } }) };
  const store = {
    resolveTenantById: vi.fn().mockResolvedValue({ tenantId: 't', status: 'active' }),
    getPendingAction: vi.fn().mockResolvedValue(null),
    createPendingAction: vi.fn().mockImplementation(async (input) => ({
      id: input.id, actorOpenId: input.actorOpenId, payload: input.payload,
      status: 'pendingConfirmation', result: { status: 'pendingConfirmation' },
    })),
  };
  const decisions = { analyze: vi.fn().mockResolvedValue({ timezone: 'Asia/Shanghai', items: [{
    id: 'task:1', version: 'v1', suggestedAction: '发送报价', state: { revision: 0 },
  }] }) };
  const executor = { schedule: vi.fn() };
  const controller = new TodayActionController(auth as never, shell as never, sessions as never,
    decisions as never, store as never, undefined, undefined, executor as never);
  const result = await controller.createTaskDraft({ headers: { origin: auth.publicOrigin,
    cookie: 'sales-agent-session=x' } } as never, { itemId: 'task:1', itemVersion: 'v1',
    idempotencyKey: 'key', title: '发送报价', dueAt: '2026-10-17T09:00:00+08:00' });
  expect(result).toMatchObject({ title: '发送报价', requiresConfirmation: true, status: 'pendingConfirmation' });
  expect(result.actionId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u);
  expect(store.createPendingAction).toHaveBeenCalled();
  expect(executor.schedule).not.toHaveBeenCalled();
  const saved = store.createPendingAction.mock.results[0];
  const pending = await saved.value;
  store.getPendingAction.mockResolvedValue(pending);
  const request = { headers: { origin: auth.publicOrigin, cookie: 'sales-agent-session=x' } } as never;
  const input = { itemId: 'task:1', itemVersion: 'v1', idempotencyKey: 'key',
    title: '发送报价', dueAt: '2026-10-17T09:00:00+08:00' };
  expect(await controller.createTaskDraft(request, input)).toEqual(result);
  for (const changed of [{ title: '另一任务' }, { dueAt: '2026-10-18T09:00:00+08:00' },
    { channel: '邮件' }, { participants: ['张总'] }]) {
    await expect(controller.createTaskDraft(request, { ...input, ...changed }))
      .rejects.toMatchObject({ status: 409 });
  }
  expect(store.createPendingAction).toHaveBeenCalledOnce();
  expect(executor.schedule).not.toHaveBeenCalled();
});

it('requires an explicit confirmation before scheduling a standalone task', async () => {
  const auth = { publicOrigin: 'https://sales.example', authenticateSession: vi.fn().mockResolvedValue({
    tenantId: 't', member: { id: 'm', feishuOpenId: 'actor' },
  }) };
  const shell = { assertPermission: vi.fn().mockResolvedValue(undefined) };
  const integration = { tenantId: 't', status: 'active' };
  const action = { id: 'task-action', actorOpenId: 'actor', status: 'pendingConfirmation',
    payload: { actionKind: 'task' }, result: { status: 'pendingConfirmation' } };
  const acquired = { ...action, status: 'executing' };
  const store = { resolveTenantById: vi.fn().mockResolvedValue(integration),
    getPendingAction: vi.fn().mockResolvedValueOnce(action),
    acquirePendingAction: vi.fn().mockResolvedValue(acquired) };
  const executor = { schedule: vi.fn() };
  const controller = new TodayActionController(auth as never, shell as never, {} as never,
    {} as never, store as never, undefined, undefined, executor as never);
  const result = await controller.confirmTaskDraft({ headers: { origin: auth.publicOrigin,
    cookie: 'sales-agent-session=x' } } as never, {}, 'task-action');
  expect(result).toEqual({ actionId: 'task-action', status: 'executing' });
  expect(store.acquirePendingAction).toHaveBeenCalled();
  expect(executor.schedule).toHaveBeenCalledWith(integration, acquired, null, expect.any(String));
});

it('returns forbidden for denied followup permission before reading sources', async () => {
  const auth = { publicOrigin: 'https://sales.example', authenticateSession: vi.fn().mockResolvedValue({
    tenantId: 't', member: { id: 'm', feishuOpenId: 'actor' },
  }) };
  const shell = { assertPermission: vi.fn().mockRejectedValue(new PlatformAccessDeniedError()) };
  const analyze = vi.fn();
  const controller = new TodayActionController(auth as never, shell as never, {} as never,
    { analyze } as never, {} as never);
  await expect(controller.createFollowup({ headers: { origin: auth.publicOrigin,
    cookie: 'sales-agent-session=x' } } as never, { itemId: 'o', itemVersion: 'v',
    idempotencyKey: 'k', communicationText: '客户反馈' })).rejects.toMatchObject({ status: 403 });
  expect(analyze).not.toHaveBeenCalled();
});

it('rejects unauthenticated requests before any data read', async () => {
  const controller = new TodayActionController({} as never, {} as never, {} as never,
    {} as never, {} as never);
  await expect(controller.getTodayActions({ headers: {} } as never)).rejects.toThrow();
});

it('does not read business data when a required permission is denied', async () => {
  const auth = { authenticateSession: vi.fn().mockResolvedValue({ tenantId: 't',
    member: { id: 'm', feishuOpenId: 'actor' } }) };
  const shell = { assertPermission: vi.fn().mockRejectedValue(new Error('denied')) };
  const store = { resolveTenantById: vi.fn() };
  const analyze = vi.fn();
  const controller = new TodayActionController(auth as never, shell as never,
    {} as never, { analyze } as never, store as never);
  await expect(controller.getTodayActions({ headers: { cookie: 'sales-agent-session=x' } } as never))
    .rejects.toThrow('denied');
  expect(store.resolveTenantById).not.toHaveBeenCalled();
  expect(analyze).not.toHaveBeenCalled();
});

it('rejects a resolved integration belonging to another tenant', async () => {
  const auth = { authenticateSession: vi.fn().mockResolvedValue({ tenantId: 'tenant-a',
    member: { id: 'member-a', feishuOpenId: 'actor-a' } }) };
  const shell = { assertPermission: vi.fn().mockResolvedValue(undefined) };
  const sessions = { getSessionByMembership: vi.fn().mockResolvedValue({ tenant: { timezone: 'Asia/Shanghai' } }) };
  const analyze = vi.fn();
  const store = { resolveTenantById: vi.fn().mockResolvedValue({ tenantId: 'tenant-b', status: 'active' }) };
  const controller = new TodayActionController(auth as never, shell as never, sessions as never,
    { analyze } as never, store as never);
  await expect(controller.getTodayActions({ headers: { cookie: 'sales-agent-session=x' } } as never))
    .rejects.toThrow();
  expect(analyze).not.toHaveBeenCalled();
  expect(store.resolveTenantById).toHaveBeenCalledWith('tenant-a');
});

it('uses only authenticated actor identity for a successful aggregate request', async () => {
  const auth = { authenticateSession: vi.fn().mockResolvedValue({ tenantId: 'tenant-a',
    member: { id: 'member-a', feishuOpenId: 'actor-a' } }) };
  const shell = { assertPermission: vi.fn().mockResolvedValue(undefined) };
  const sessions = { getSessionByMembership: vi.fn().mockResolvedValue({ tenant: { timezone: 'Asia/Shanghai' } }) };
  const integration = { tenantId: 'tenant-a', status: 'active' };
  const store = { resolveTenantById: vi.fn().mockResolvedValue(integration) };
  const analyze = vi.fn().mockResolvedValue({ items: [] });
  const controller = new TodayActionController(auth as never, shell as never, sessions as never,
    { analyze } as never, store as never);
  await controller.getTodayActions({ headers: { cookie: 'sales-agent-session=x' },
    query: { actorOpenId: 'intruder', tenantId: 'tenant-b' } } as never, '2026-10-16');
  expect(analyze).toHaveBeenCalledWith({ integration, actorOpenId: 'actor-a',
    referenceDate: '2026-10-16', timezone: 'Asia/Shanghai' });
  expect(shell.assertPermission.mock.calls.map((call) => call[1]))
    .toEqual(['opportunity:read', 'customer:read', 'task:read']);
});

it('returns a validation error for malformed dates before invoking the aggregate', async () => {
  const auth = { authenticateSession: vi.fn().mockResolvedValue({ tenantId: 't',
    member: { id: 'm', feishuOpenId: 'actor' } }) };
  const shell = { assertPermission: vi.fn().mockResolvedValue(undefined) };
  const sessions = { getSessionByMembership: vi.fn().mockResolvedValue({ tenant: { timezone: 'Asia/Shanghai' } }) };
  const analyze = vi.fn();
  const store = { resolveTenantById: vi.fn().mockResolvedValue({ tenantId: 't', status: 'active' }) };
  const controller = new TodayActionController(auth as never, shell as never, sessions as never,
    { analyze } as never, store as never);
  await expect(controller.getTodayActions({ headers: { cookie: 'sales-agent-session=x' } } as never,
    '2026-02-30')).rejects.toMatchObject({ status: 400 });
  expect(analyze).not.toHaveBeenCalled();
});

it('returns durable state when reading the same visible signal after refresh', async () => {
  const auth = { authenticateSession: vi.fn().mockResolvedValue({ tenantId: 't',
    member: { id: 'm', feishuOpenId: 'actor' } }) };
  const shell = { assertPermission: vi.fn().mockResolvedValue(undefined) };
  const sessions = { getSessionByMembership: vi.fn().mockResolvedValue({ tenant: { timezone: 'Asia/Shanghai' } }) };
  const saved = { itemId: 'task:1', itemVersion: 'v1', revision: 1, status: 'resolved', remindAt: null };
  const states = { read: vi.fn().mockResolvedValue(saved) };
  const analyze = vi.fn().mockResolvedValue({ items: [{ id: 'task:1', version: 'v1', state: { status: 'open' } }] });
  const store = { resolveTenantById: vi.fn().mockResolvedValue({ tenantId: 't', status: 'active' }) };
  const controller = new TodayActionController(auth as never, shell as never, sessions as never,
    { analyze } as never, store as never, states as never);
  const result = await controller.getTodayActions({ headers: { cookie: 'sales-agent-session=x' } } as never);
  expect(result.items[0].state).toEqual(saved);
  expect(states.read).toHaveBeenCalledWith({ tenantId: 't', memberId: 'm', actorOpenId: 'actor' }, 'task:1', 'v1');
});

it('rejects state operations without login', async () => {
  const controller = new TodayActionController({} as never, {} as never, {} as never,
    {} as never, {} as never);
  await expect(controller.operate({ headers: {} } as never, { itemId: 'x', itemVersion: 'v',
    operation: 'resolve', expectedRevision: 0, idempotencyKey: 'k' })).rejects.toThrow();
});

it('rejects operations for an invisible or changed signal before touching durable state', async () => {
  const auth = { authenticateSession: vi.fn().mockResolvedValue({ tenantId: 't',
    member: { id: 'm', feishuOpenId: 'actor' } }) };
  const shell = { assertPermission: vi.fn().mockResolvedValue(undefined) };
  const sessions = { getSessionByMembership: vi.fn().mockResolvedValue({ tenant: { timezone: 'Asia/Shanghai' } }) };
  const states = { read: vi.fn(), apply: vi.fn() };
  const analyze = vi.fn().mockResolvedValue({ items: [] });
  const store = { resolveTenantById: vi.fn().mockResolvedValue({ tenantId: 't', status: 'active' }) };
  const controller = new TodayActionController(auth as never, shell as never, sessions as never,
    { analyze } as never, store as never, states as never);
  await expect(controller.operate({ headers: { cookie: 'sales-agent-session=x' } } as never,
    { itemId: 'other', itemVersion: 'old', operation: 'resolve', expectedRevision: 0,
      idempotencyKey: 'key' })).rejects.toMatchObject({ status: 409 });
  expect(states.apply).not.toHaveBeenCalled();
});

it('applies only a visible version with server authenticated ownership', async () => {
  const auth = { authenticateSession: vi.fn().mockResolvedValue({ tenantId: 't',
    member: { id: 'm', feishuOpenId: 'actor' } }) };
  const shell = { assertPermission: vi.fn().mockResolvedValue(undefined) };
  const sessions = { getSessionByMembership: vi.fn().mockResolvedValue({ tenant: { timezone: 'Asia/Shanghai' } }) };
  const input = { itemId: 'task:1', itemVersion: 'v1', operation: 'resolve' as const,
    expectedRevision: 0, idempotencyKey: 'key' };
  const saved = { itemId: 'task:1', itemVersion: 'v1', revision: 1, status: 'resolved', remindAt: null };
  const states = { read: vi.fn().mockResolvedValue(null), apply: vi.fn().mockResolvedValue(saved) };
  const analyze = vi.fn().mockResolvedValue({ items: [{ id: 'task:1', version: 'v1' }] });
  const store = { resolveTenantById: vi.fn().mockResolvedValue({ tenantId: 't', status: 'active' }) };
  const controller = new TodayActionController(auth as never, shell as never, sessions as never,
    { analyze } as never, store as never, states as never);
  expect(await controller.operate({ headers: { cookie: 'sales-agent-session=x' } } as never, input)).toEqual(saved);
  expect(states.apply).toHaveBeenCalledWith({ tenantId: 't', memberId: 'm', actorOpenId: 'actor' }, input, expect.any(Date));
});

it('rejects a foreign origin before authenticating or changing action state', async () => {
  const auth = { publicOrigin: 'https://sales.example', authenticateSession: vi.fn() };
  const states = { apply: vi.fn() };
  const controller = new TodayActionController(auth as never, {} as never, {} as never,
    {} as never, {} as never, states as never);
  await expect(controller.operate({ headers: { origin: 'https://other.example' } } as never,
    { itemId: 'x', itemVersion: 'v', operation: 'resolve', expectedRevision: 0,
      idempotencyKey: 'k' })).rejects.toMatchObject({ status: 403 });
  expect(auth.authenticateSession).not.toHaveBeenCalled();
  expect(states.apply).not.toHaveBeenCalled();
});

it('rejects generating followup drafts without authentication', async () => {
  const controller = new TodayActionController({} as never, {} as never, {} as never,
    {} as never, {} as never);
  await expect(controller.createFollowup({ headers: {} } as never, { itemId: 'x',
    itemVersion: 'v', idempotencyKey: 'key', communicationText: '客户今天确认预算' })).rejects.toThrow();
});

it('requires a valid signal identity before generating a draft', async () => {
  const auth = { publicOrigin: 'https://sales.example', authenticateSession: vi.fn().mockResolvedValue({
    tenantId: 't', member: { id: 'm', feishuOpenId: 'actor' },
  }) };
  const shell = { assertPermission: vi.fn().mockResolvedValue(undefined) };
  const workflow = { create: vi.fn() };
  const controller = new TodayActionController(auth as never, shell as never, {} as never,
    {} as never, {} as never, undefined, workflow as never);
  await expect(controller.createFollowup({ headers: { origin: auth.publicOrigin,
    cookie: 'sales-agent-session=x' } } as never, {
    itemId: '', itemVersion: 'v', idempotencyKey: 'k', communicationText: '真实沟通',
  })).rejects.toMatchObject({ status: 400 });
  expect(workflow.create).not.toHaveBeenCalled();
});

it('creates only a confirmation draft from actual communication under authenticated ownership', async () => {
  const auth = { publicOrigin: 'https://sales.example', authenticateSession: vi.fn().mockResolvedValue({
    tenantId: 't', member: { id: 'm', feishuOpenId: 'actor' },
  }) };
  const shell = { assertPermission: vi.fn().mockResolvedValue(undefined) };
  const sessions = { getSessionByMembership: vi.fn().mockResolvedValue({ tenant: { timezone: 'Asia/Shanghai' } }) };
  const analyze = vi.fn().mockResolvedValue({ timezone: 'Asia/Shanghai', items: [{ id: 'o', version: 'v',
    suggestedAction: '尚未执行的建议' }] });
  const store = { resolveTenantById: vi.fn().mockResolvedValue({ tenantId: 't', status: 'active' }) };
  const workflow = { create: vi.fn().mockResolvedValue({ id: 'draft' }) };
  const controller = new TodayActionController(auth as never, shell as never, sessions as never,
    { analyze } as never, store as never, undefined, workflow as never);
  const result = await controller.createFollowup({ headers: { origin: auth.publicOrigin,
    cookie: 'sales-agent-session=x' } } as never, { itemId: 'o', itemVersion: 'v',
    idempotencyKey: 'key', communicationText: '客户已确认预算' });
  expect(result).toEqual({ draftId: 'draft', requiresConfirmation: true });
  expect(workflow.create).toHaveBeenCalledWith({ tenantId: 't', ownerMemberId: 'm',
    ownerOpenId: 'actor', sourceType: 'text', text: '客户已确认预算',
    idempotencyKey: 'today:o:v:key', timezone: 'Asia/Shanghai', now: expect.any(Date) });
  expect(shell.assertPermission).toHaveBeenCalledWith(expect.anything(), 'followup:create-own');
});

it('reads only an owned task result without acquiring a lease or scheduling work', async () => {
  const auth = { authenticateSession: vi.fn().mockResolvedValue({ tenantId: 'tenant',
    member: { feishuOpenId: 'actor' } }) };
  const shell = { assertPermission: vi.fn() };
  const store = { getPendingAction: vi.fn().mockResolvedValue({ id: 'task', actorOpenId: 'actor',
    payload: { actionKind: 'task', draft: { nextAction: '核对报价', dueAt: '2026-10-18T09:00:00Z' } }, status: 'succeeded', result: { taskGuid: 'guid' } }) };
  const executor = { schedule: vi.fn() };
  const controller = new TodayActionController(auth as never, shell as never, {} as never,
    {} as never, store as never, undefined, undefined, executor as never);
  const request = { headers: { cookie: 'sales-agent-session=x' } } as never;
  expect(await controller.getTaskStatus(request, 'task')).toMatchObject({ status: 'succeeded', taskGuid: 'guid' });
  expect(store.getPendingAction).toHaveBeenCalledWith('tenant', 'task');
  expect(shell.assertPermission).toHaveBeenCalledWith(expect.anything(), 'task:read');
  store.getPendingAction.mockResolvedValue({ actorOpenId: 'other', payload: { actionKind: 'task' } });
  await expect(controller.getTaskStatus(request, 'task')).rejects.toMatchObject({ status: 403 });
  expect(executor.schedule).not.toHaveBeenCalled();
});

