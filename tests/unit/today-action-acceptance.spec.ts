import { expect, it, vi } from 'vitest';
import { runTodayActionAcceptance } from '@server/modules/insight/today-action-acceptance';

const fixture = () => {
  const item = { id: 'task:test', version: 'v1', kind: 'task_due' as const,
    sourceId: 'test', customerRecordId: null, title: 'TCL-UAT-20261018 核实预算',
    reason: '今日截止', evidence: ['测试证据'], suggestedAction: '联系客户',
    suggestedCompletionDate: '2026-10-18', sourceUrl: null,
    state: { itemId: 'task:test', itemVersion: 'v1', status: 'open' as const, revision: 0, remindAt: null } };
  const input = { tenantId: 'tenant', memberId: 'member', recipientOpenId: 'owner',
    itemIds: [item.id], marker: 'TCL-UAT-20261018', runKey: 'uat-first',
    now: new Date('2026-10-18T10:00:00Z') };
  const deps = {
    settings: { allowedTenantId: 'tenant', allowedMemberId: 'member', allowedRecipientOpenId: 'owner' },
    control: { listActiveIntegrations: vi.fn().mockResolvedValue([{ tenantId: 'tenant', status: 'active' }]) },
    identity: { listMembers: vi.fn().mockResolvedValue([{ tenantId: 'tenant', id: 'member', feishuOpenId: 'owner', status: 'active' }]) },
    sessions: { getSessionByMembership: vi.fn().mockResolvedValue({ tenant: { id: 'tenant', timezone: 'Asia/Shanghai' },
      member: { id: 'member', feishuOpenId: 'owner' }, permissions: ['customer:read', 'opportunity:read', 'task:read'] }) },
    actions: { analyze: vi.fn().mockResolvedValue({ items: [item, { ...item, id: 'history', title: 'PRIVATE HISTORY' }], warnings: ['PRIVATE WARNING'] }) },
    states: { read: vi.fn().mockResolvedValue(null) },
    delivery: { deliver: vi.fn().mockResolvedValue({ status: 'sent', messageId: 'message' }) },
  };
  return { item, input, deps, run: (overrides = {}) => runTodayActionAcceptance(deps as never, { ...input, ...overrides }) };
};

it('previews only selected test evidence with zero delivery and no historical warnings', async () => {
  const f = fixture(); const result = await f.run();
  expect(result.mode).toBe('preview');
  expect(JSON.stringify(result.message)).toContain('测试证据');
  expect(JSON.stringify(result.message)).not.toContain('PRIVATE');
  expect(result.message.shortcuts).toHaveLength(4);
  expect(f.deps.delivery.deliver).not.toHaveBeenCalled();
  expect(f.deps.states.read).toHaveBeenCalledTimes(1);
});

it.each([
  { itemIds: [] }, { itemIds: ['task:test', 'task:test'] },
  { itemIds: ['missing'] }, { itemIds: ['history'] },
  { itemIds: ['a', 'b', 'c'] }, { marker: '' }, { runKey: '' },
  { tenantId: 'other' }, { memberId: 'other' }, { recipientOpenId: 'other' },
])('rejects invalid selection or rollout mismatch without delivery %j', async (override) => {
  const f = fixture(); await expect(f.run({ ...override, send: true })).rejects.toThrow();
  expect(f.deps.delivery.deliver).not.toHaveBeenCalled();
});

it('rejects a handled state instead of silently selecting another item', async () => {
  const f = fixture(); f.deps.states.read.mockResolvedValue({ ...f.item.state, status: 'resolved' } as never);
  await expect(f.run({ send: true })).rejects.toThrow('SELECTION_INVALID');
  expect(f.deps.delivery.deliver).not.toHaveBeenCalled();
});

it.each(['tenant', 'member', 'permission'])('rejects mismatched %s session', async (kind) => {
  const f = fixture(); const session = await f.deps.sessions.getSessionByMembership();
  if (kind === 'tenant') session.tenant.id = 'other';
  if (kind === 'member') session.member.feishuOpenId = 'other';
  if (kind === 'permission') session.permissions = [];
  f.deps.sessions.getSessionByMembership.mockResolvedValue(session);
  await expect(f.run({ send: true })).rejects.toThrow('ACCESS_DENIED');
  expect(f.deps.delivery.deliver).not.toHaveBeenCalled();
});

it('dispatches at most one message via the existing ledger with a stable run key', async () => {
  const f = fixture(); const first = await f.run({ send: true });
  await f.run({ send: true, now: new Date('2026-10-18T10:01:00Z') });
  expect(f.deps.delivery.deliver).toHaveBeenCalledTimes(2);
  const calls = f.deps.delivery.deliver.mock.calls;
  expect(calls[0][0].message.notificationKey).toBe(calls[1][0].message.notificationKey);
  expect(first.message.subjectKey).toBe('today-action-acceptance');
});
