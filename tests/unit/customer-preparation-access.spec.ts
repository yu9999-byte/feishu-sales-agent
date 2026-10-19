import { expect, it, vi } from 'vitest';
import { CustomerPreparationAccessService } from '@server/modules/insight/customer-preparation-access.service';
import type { TenantIntegration } from '@server/modules/agent-core/agent.types';

const setup = () => {
  const member = { id: 'member', tenantId: 'tenant', feishuOpenId: 'actor', status: 'active' };
  const session = { tenant: { id: 'tenant' }, member: { id: 'member', feishuOpenId: 'actor' },
    permissions: ['customer:read', 'opportunity:read', 'followup:read', 'playbook:read'] };
  const sessions = { getActiveMember: vi.fn().mockResolvedValue(member),
    getSessionByMembership: vi.fn().mockResolvedValue(session) };
  const records = { readOpportunityPortfolio: vi.fn().mockResolvedValue({ warnings: [],
    customers: [{ recordId: 'a', name: '客户甲' }, { recordId: 'b', name: '其他客户' }] }) };
  const integration = { tenantId: 'tenant', status: 'active' } as TenantIntegration;
  return { member, session, sessions, records, integration,
    service: new CustomerPreparationAccessService(sessions as never, records as never) };
};

it('reads only the verified actor portfolio and returns matching candidates', async () => {
  const f = setup();
  expect(await f.service.resolve(f.integration, 'actor', '客户甲')).toEqual({
    status: 'matched', candidates: [{ recordId: 'a', name: '客户甲' }], coverage: 'complete' });
  expect(f.records.readOpportunityPortfolio).toHaveBeenCalledExactlyOnceWith(f.integration, 'actor');
});

it.each(['inactive', 'no_member', 'foreign_member', 'foreign_tenant', 'foreign_actor', 'missing_permission'])(
  'denies %s before reading records', async (scenario: string) => {
    const f = setup();
    if (scenario === 'inactive') f.integration.status = 'disabled';
    if (scenario === 'no_member') f.sessions.getActiveMember.mockResolvedValue(null);
    if (scenario === 'foreign_member') f.sessions.getActiveMember.mockResolvedValue({ ...f.member, tenantId: 'other' });
    if (scenario === 'foreign_tenant') f.session.tenant.id = 'other';
    if (scenario === 'foreign_actor') f.session.member.feishuOpenId = 'other';
    if (scenario === 'missing_permission') f.session.permissions.pop();
    await expect(f.service.resolve(f.integration, 'actor', '客户甲')).rejects.toThrow('ACCESS_DENIED');
    expect(f.records.readOpportunityPortfolio).not.toHaveBeenCalled();
  },
);

it('distinguishes source failure from no match without exposing exception text', async () => {
  const f = setup();
  f.records.readOpportunityPortfolio.mockRejectedValue(new Error('private-token'));
  expect(await f.service.resolve(f.integration, 'actor', '客户甲'))
    .toEqual({ status: 'unavailable', candidates: [], coverage: 'unavailable' });
});

it('preserves partial coverage and rechecks visibility on every resolution', async () => {
  const f = setup();
  f.records.readOpportunityPortfolio.mockResolvedValue({ warnings: ['source-partial'],
    customers: [{ recordId: 'a', name: '客户甲' }, { recordId: 'c', name: '客户甲' }] });
  expect(await f.service.resolve(f.integration, 'actor', '客户甲')).toMatchObject({
    status: 'ambiguous', coverage: 'partial', candidates: [{ recordId: 'a' }, { recordId: 'c' }] });
  f.records.readOpportunityPortfolio.mockResolvedValue({ warnings: [], customers: [] });
  expect(await f.service.resolve(f.integration, 'actor', '客户甲')).toMatchObject({ status: 'not_found' });
  expect(f.records.readOpportunityPortfolio).toHaveBeenCalledTimes(2);
});
