import { describe, expect, it } from 'vitest';

import {
  AuthorizationPolicyService,
  getPermissionsForRoles,
  isPlatformRole,
} from '@server/modules/identity-access/authorization-policy.service';
import {
  createAuthorizationAuditInput,
} from '@server/modules/identity-access/authorization-audit';
import type {
  AuthorizationInput,
  AuthorizationRequest,
  PlatformMember,
  ReportingRelation,
  ResourceGrant,
  RoleAssignment,
} from '@server/modules/identity-access/identity-access.types';
import type { PlatformRole } from '@shared/api.interface';

const TENANT_A: string = '00000000-0000-4000-8000-00000000000a';
const TENANT_B: string = '00000000-0000-4000-8000-00000000000b';
const NOW: Date = new Date('2026-09-19T10:00:00+08:00');

const members: PlatformMember[] = [
  {
    id: 'member-sales-a',
    tenantId: TENANT_A,
    feishuOpenId: 'ou_sales_a',
    displayName: '林岚',
    status: 'active',
  },
  {
    id: 'member-sales-b',
    tenantId: TENANT_A,
    feishuOpenId: 'ou_sales_b',
    displayName: '周弋',
    status: 'active',
  },
  {
    id: 'member-manager',
    tenantId: TENANT_A,
    feishuOpenId: 'ou_manager',
    displayName: '顾宁',
    status: 'active',
  },
  {
    id: 'member-director',
    tenantId: TENANT_A,
    feishuOpenId: 'ou_director',
    displayName: '陈峤',
    status: 'active',
  },
  {
    id: 'member-executive',
    tenantId: TENANT_A,
    feishuOpenId: 'ou_executive',
    displayName: '许澄',
    status: 'active',
  },
  {
    id: 'member-admin',
    tenantId: TENANT_A,
    feishuOpenId: 'ou_admin',
    displayName: '唐乔',
    status: 'active',
  },
  {
    id: 'member-dual-tenant',
    tenantId: TENANT_B,
    feishuOpenId: 'ou_sales_a',
    displayName: '林岚',
    status: 'active',
  },
];

const assignments: RoleAssignment[] = [
  {
    tenantId: TENANT_A,
    memberId: 'member-sales-a',
    role: 'sales',
    validFrom: new Date('2026-01-01T00:00:00+08:00'),
    validTo: null,
  },
  {
    tenantId: TENANT_A,
    memberId: 'member-sales-b',
    role: 'sales',
    validFrom: new Date('2026-01-01T00:00:00+08:00'),
    validTo: null,
  },
  {
    tenantId: TENANT_A,
    memberId: 'member-manager',
    role: 'manager',
    validFrom: new Date('2026-01-01T00:00:00+08:00'),
    validTo: null,
  },
  {
    tenantId: TENANT_A,
    memberId: 'member-director',
    role: 'manager',
    validFrom: new Date('2026-01-01T00:00:00+08:00'),
    validTo: null,
  },
  {
    tenantId: TENANT_A,
    memberId: 'member-executive',
    role: 'executive',
    validFrom: new Date('2026-01-01T00:00:00+08:00'),
    validTo: null,
  },
  {
    tenantId: TENANT_A,
    memberId: 'member-admin',
    role: 'admin',
    validFrom: new Date('2026-01-01T00:00:00+08:00'),
    validTo: null,
  },
  {
    tenantId: TENANT_B,
    memberId: 'member-dual-tenant',
    role: 'admin',
    validFrom: new Date('2026-01-01T00:00:00+08:00'),
    validTo: null,
  },
];

const relations: ReportingRelation[] = [
  {
    tenantId: TENANT_A,
    managerMemberId: 'member-manager',
    reportMemberId: 'member-sales-a',
    validFrom: new Date('2026-01-01T00:00:00+08:00'),
    validTo: null,
  },
  {
    tenantId: TENANT_A,
    managerMemberId: 'member-director',
    reportMemberId: 'member-manager',
    validFrom: new Date('2026-01-01T00:00:00+08:00'),
    validTo: null,
  },
];

const createRequest = (
  actorMemberId: string,
  overrides: Partial<AuthorizationRequest> = {},
): AuthorizationRequest => ({
  tenantId: TENANT_A,
  actorMemberId,
  action: 'customer:read',
  resourceType: 'customer',
  resourceTenantId: TENANT_A,
  resourceOwnerMemberId: actorMemberId,
  resourceRef: 'customer-42',
  occurredAt: NOW,
  ...overrides,
});

const authorize = (
  request: AuthorizationRequest,
  overrides: Partial<AuthorizationInput> = {},
) => {
  const service: AuthorizationPolicyService =
    new AuthorizationPolicyService();
  return service.authorize({
    request,
    members,
    assignments,
    relations,
    grants: [],
    policyVersion: 'platform-authz-v1',
    ...overrides,
  });
};

describe('AuthorizationPolicyService', (): void => {
  it('allows sales to read owned resources only', (): void => {
    expect(authorize(createRequest('member-sales-a'))).toMatchObject({
      allowed: true,
      reasonCode: 'allowed',
      dataScope: 'self',
    });

    expect(authorize(createRequest('member-sales-a', {
      resourceOwnerMemberId: 'member-sales-b',
    }))).toMatchObject({
      allowed: false,
      reasonCode: 'outside-data-scope',
      publicReason: 'access-denied',
    });
  });

  it('allows managers to read recursive reports but not other teams', (): void => {
    expect(authorize(createRequest('member-director', {
      resourceOwnerMemberId: 'member-sales-a',
    }))).toMatchObject({
      allowed: true,
      dataScope: 'team',
    });

    expect(authorize(createRequest('member-manager', {
      resourceOwnerMemberId: 'member-sales-b',
    }))).toMatchObject({
      allowed: false,
      reasonCode: 'outside-data-scope',
    });
  });

  it('allows executives to read tenant data but not administer members', (): void => {
    expect(authorize(createRequest('member-executive', {
      resourceOwnerMemberId: 'member-sales-b',
    }))).toMatchObject({
      allowed: true,
      dataScope: 'tenant',
    });

    expect(authorize(createRequest('member-executive', {
      action: 'admin:manage-members',
      resourceType: 'tenant-member',
    }))).toMatchObject({
      allowed: false,
      reasonCode: 'permission-missing',
    });
  });

  it('does not let an admin confirm a sales followup by default', (): void => {
    expect(authorize(createRequest('member-admin', {
      action: 'admin:manage-members',
      resourceType: 'tenant-member',
      resourceOwnerMemberId: 'member-sales-a',
    }))).toMatchObject({ allowed: true, dataScope: 'tenant' });

    expect(authorize(createRequest('member-admin', {
      action: 'followup:confirm-own',
      resourceType: 'followup',
      resourceOwnerMemberId: 'member-sales-a',
    }))).toMatchObject({
      allowed: false,
      reasonCode: 'permission-missing',
    });
  });

  it('keeps the same Feishu user roles isolated between tenants', (): void => {
    expect(authorize(createRequest('member-sales-a', {
      action: 'admin:manage-members',
      resourceType: 'tenant-member',
    }))).toMatchObject({ allowed: false });

    expect(authorize(createRequest('member-dual-tenant', {
      tenantId: TENANT_B,
      resourceTenantId: TENANT_B,
      action: 'admin:manage-members',
      resourceType: 'tenant-member',
    }))).toMatchObject({
      allowed: true,
      effectiveRoles: ['admin'],
    });
  });

  it('rejects a cross-tenant resource before evaluating its details', (): void => {
    expect(authorize(createRequest('member-admin', {
      resourceTenantId: TENANT_B,
      action: 'admin:manage-members',
      resourceType: 'tenant-member',
      resourceRef: 'same-id-in-another-tenant',
    }))).toMatchObject({
      allowed: false,
      reasonCode: 'tenant-mismatch',
      publicReason: 'access-denied',
    });
  });

  it('rejects expired roles and expired grants', (): void => {
    const expiredAssignment: RoleAssignment = {
      tenantId: TENANT_A,
      memberId: 'member-sales-a',
      role: 'sales',
      validFrom: new Date('2026-01-01T00:00:00+08:00'),
      validTo: new Date('2026-09-01T00:00:00+08:00'),
    };
    expect(authorize(createRequest('member-sales-a'), {
      assignments: [expiredAssignment],
    })).toMatchObject({
      allowed: false,
      reasonCode: 'permission-missing',
    });

    const expiredGrant: ResourceGrant = {
      tenantId: TENANT_A,
      granteeMemberId: 'member-sales-a',
      resourceType: 'customer',
      resourceRef: 'customer-42',
      permission: 'customer:read',
      validFrom: new Date('2026-01-01T00:00:00+08:00'),
      validTo: new Date('2026-09-01T00:00:00+08:00'),
    };
    expect(authorize(createRequest('member-sales-a', {
      resourceOwnerMemberId: 'member-sales-b',
    }), { grants: [expiredGrant] })).toMatchObject({
      allowed: false,
      reasonCode: 'grant-expired',
    });
  });

  it('accepts an active explicit grant without widening other resources', (): void => {
    const activeGrant: ResourceGrant = {
      tenantId: TENANT_A,
      granteeMemberId: 'member-sales-a',
      resourceType: 'customer',
      resourceRef: 'customer-42',
      permission: 'customer:read',
      validFrom: new Date('2026-01-01T00:00:00+08:00'),
      validTo: new Date('2026-12-31T00:00:00+08:00'),
    };
    expect(authorize(createRequest('member-sales-a', {
      resourceOwnerMemberId: 'member-sales-b',
    }), { grants: [activeGrant] })).toMatchObject({
      allowed: true,
      dataScope: 'granted',
    });

    expect(authorize(createRequest('member-sales-a', {
      resourceOwnerMemberId: 'member-sales-b',
      resourceRef: 'customer-99',
    }), { grants: [activeGrant] })).toMatchObject({ allowed: false });
  });

  it('terminates reporting cycles without widening the team', (): void => {
    const cyclicRelations: ReportingRelation[] = [
      ...relations,
      {
        tenantId: TENANT_A,
        managerMemberId: 'member-sales-a',
        reportMemberId: 'member-director',
        validFrom: new Date('2026-01-01T00:00:00+08:00'),
        validTo: null,
      },
    ];

    const decision = authorize(createRequest('member-manager', {
      resourceOwnerMemberId: 'member-director',
    }), { relations: cyclicRelations });

    expect(decision.allowed).toBe(false);
    expect(decision.reasonCode).toBe('outside-data-scope');
    expect(decision.diagnostics).toContain('reporting-cycle');
  });

  it('creates a redacted audit input for denied access', (): void => {
    const request: AuthorizationRequest = createRequest('member-sales-a', {
      resourceOwnerMemberId: 'member-sales-b',
      resourceRef: 'customer-sensitive-id',
    });
    const decision = authorize(request);
    const audit = createAuthorizationAuditInput({
      request,
      decision,
      traceId: 'trace-authz-denied',
      roleSnapshot: ['sales'],
      sensitiveContext: {
        authorization: 'Bearer secret-token',
        customerText: '客户原始内容',
      },
    });
    const serialized: string = JSON.stringify(audit);

    expect(audit.resourceRefHash).not.toBe(request.resourceRef);
    expect(serialized).not.toContain('customer-sensitive-id');
    expect(serialized).not.toContain('secret-token');
    expect(serialized).not.toContain('客户原始内容');
    expect(audit.outcome).toBe('denied');
  });

  it('fails closed for an invalid role supplied by stored data', (): void => {
    const malformed = 'constructor' as PlatformRole;
    expect(isPlatformRole(malformed)).toBe(false);
    const request: AuthorizationRequest = createRequest('member-sales-a');
    const decision = authorize(request, {
      assignments: [{
        tenantId: TENANT_A,
        memberId: 'member-sales-a',
        role: malformed,
        validFrom: new Date('2026-01-01T00:00:00+08:00'),
        validTo: null,
      }],
    });
    expect(decision).toMatchObject({
      allowed: false,
      reasonCode: 'permission-missing',
    });
    expect(getPermissionsForRoles([malformed])).toEqual([]);
  });
});
