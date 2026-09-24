import { describe, expect, it } from 'vitest';

import {
  PlatformAccessDeniedError,
  PlatformSessionService,
} from '@server/modules/platform-shell/platform-session.service';
import type {
  IdentityAccessRepository,
  PlatformTenant,
  TrustedWebIdentity,
} from '@server/modules/identity-access/identity-access.ports';
import type {
  PlatformMember,
  ReportingRelation,
  ResourceGrant,
  RoleAssignment,
} from '@server/modules/identity-access/identity-access.types';
import type {
  PlatformNavigationKey,
  PlatformPermission,
  PlatformRole,
  PlatformSessionResponse,
} from '@shared/api.interface';

const TENANT_ID: string = '00000000-0000-4000-8000-00000000000a';
const NOW: Date = new Date('2026-09-19T12:00:00+08:00');

const tenant: PlatformTenant = {
  id: TENANT_ID,
  feishuTenantKey: 'tenant-a',
  name: '华东示范企业',
  timezone: 'Asia/Shanghai',
  status: 'active',
};

const identity: TrustedWebIdentity = {
  feishuTenantKey: 'tenant-a',
  feishuOpenId: 'ou_current_user',
};

class FakeIdentityAccessRepository implements IdentityAccessRepository {
  constructor(
    private readonly member: PlatformMember | null,
    private readonly roleAssignments: RoleAssignment[],
    private readonly selectedTenant: PlatformTenant | null = tenant,
  ) {}

  async resolveTenantById(
    tenantId: string,
  ): Promise<PlatformTenant | null> {
    return this.selectedTenant?.id === tenantId
      ? structuredClone(this.selectedTenant)
      : null;
  }

  async resolveTenantByFeishuKey(
    feishuTenantKey: string,
  ): Promise<PlatformTenant | null> {
    if (this.selectedTenant?.feishuTenantKey !== feishuTenantKey) {
      return null;
    }
    return structuredClone(this.selectedTenant);
  }

  async resolveMemberByOpenId(
    tenantId: string,
    feishuOpenId: string,
  ): Promise<PlatformMember | null> {
    if (
      this.member?.tenantId !== tenantId ||
      this.member.feishuOpenId !== feishuOpenId
    ) {
      return null;
    }
    return structuredClone(this.member);
  }

  async resolveMemberById(
    tenantId: string,
    memberId: string,
  ): Promise<PlatformMember | null> {
    if (
      this.member?.tenantId !== tenantId ||
      this.member.id !== memberId
    ) {
      return null;
    }
    return structuredClone(this.member);
  }

  async updateMemberDisplayName(): Promise<void> {}

  async listMembers(_tenantId: string): Promise<PlatformMember[]> {
    return this.member === null ? [] : [structuredClone(this.member)];
  }

  async listRoleAssignments(
    _tenantId: string,
    _memberId: string,
  ): Promise<RoleAssignment[]> {
    return structuredClone(this.roleAssignments);
  }

  async listReportingRelations(
    _tenantId: string,
  ): Promise<ReportingRelation[]> {
    return [];
  }

  async listResourceGrants(
    _tenantId: string,
    _memberId: string,
  ): Promise<ResourceGrant[]> {
    return [];
  }
}

const createMember = (
  status: 'active' | 'disabled' = 'active',
): PlatformMember => ({
  id: 'member-current',
  tenantId: TENANT_ID,
  feishuOpenId: 'ou_current_user',
  displayName: '季然',
  status,
});

const createAssignments = (roles: PlatformRole[]): RoleAssignment[] =>
  roles.map((role: PlatformRole): RoleAssignment => ({
    tenantId: TENANT_ID,
    memberId: 'member-current',
    role,
    validFrom: new Date('2026-01-01T00:00:00+08:00'),
    validTo: null,
  }));

const getSession = async (
  roles: PlatformRole[],
): Promise<PlatformSessionResponse> => {
  const repository: IdentityAccessRepository =
    new FakeIdentityAccessRepository(
      createMember(),
      createAssignments(roles),
    );
  const service: PlatformSessionService =
    new PlatformSessionService(repository);
  return service.getSession(identity, NOW);
};

const navigationKeys = (
  session: PlatformSessionResponse,
): PlatformNavigationKey[] =>
  session.navigation.map(
    (item): PlatformNavigationKey => item.key,
  );

describe('PlatformSessionService', (): void => {
  it('returns a sales session without manager or admin navigation', async (): Promise<void> => {
    const session: PlatformSessionResponse = await getSession(['sales']);

    expect(session.tenant).toEqual({
      id: TENANT_ID,
      name: '华东示范企业',
      timezone: 'Asia/Shanghai',
    });
    expect(session.member).toEqual({
      id: 'member-current',
      feishuOpenId: 'ou_current_user',
      displayName: '季然',
    });
    expect(navigationKeys(session)).toEqual([
      'workspace',
      'customers',
      'opportunities',
      'followups',
      'tasks',
      'analytics',
      'playbooks',
    ]);
    expect(session.navigation).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: 'reviews' }),
        expect.objectContaining({ key: 'admin' }),
      ]),
    );
  });

  it.each<{
    role: PlatformRole;
    requiredNavigation: PlatformNavigationKey[];
    requiredPermissions: PlatformPermission[];
  }>([
    {
      role: 'manager',
      requiredNavigation: ['reviews', 'analytics'],
      requiredPermissions: ['review:read-team', 'task:assign'],
    },
    {
      role: 'executive',
      requiredNavigation: ['reviews', 'analytics'],
      requiredPermissions: ['review:read-team', 'analytics:read'],
    },
    {
      role: 'admin',
      requiredNavigation: ['reviews', 'analytics', 'admin'],
      requiredPermissions: ['admin:manage-members', 'audit:read'],
    },
  ])(
    'returns the expected navigation and permissions for $role',
    async ({
      role,
      requiredNavigation,
      requiredPermissions,
    }): Promise<void> => {
      const session: PlatformSessionResponse = await getSession([role]);
      const keys: PlatformNavigationKey[] = navigationKeys(session);

      requiredNavigation.forEach((key: PlatformNavigationKey): void => {
        expect(keys).toContain(key);
      });
      requiredPermissions.forEach(
        (permission: PlatformPermission): void => {
          expect(session.permissions).toContain(permission);
        },
      );
    },
  );

  it('unions roles without duplicating permissions or navigation', async (): Promise<void> => {
    const session: PlatformSessionResponse = await getSession([
      'sales',
      'manager',
    ]);
    const keys: PlatformNavigationKey[] = navigationKeys(session);

    expect(new Set(session.permissions).size).toBe(
      session.permissions.length,
    );
    expect(new Set(keys).size).toBe(keys.length);
    expect(session.roles).toEqual(['sales', 'manager']);
  });

  it('ignores expired role assignments at request time', async (): Promise<void> => {
    const expired: RoleAssignment = {
      tenantId: TENANT_ID,
      memberId: 'member-current',
      role: 'admin',
      validFrom: new Date('2026-01-01T00:00:00+08:00'),
      validTo: new Date('2026-09-01T00:00:00+08:00'),
    };
    const repository: IdentityAccessRepository =
      new FakeIdentityAccessRepository(createMember(), [expired]);
    const service: PlatformSessionService =
      new PlatformSessionService(repository);

    await expect(service.getSession(identity, NOW)).rejects.toBeInstanceOf(
      PlatformAccessDeniedError,
    );
  });

  it('uses the same safe error for unknown and disabled memberships', async (): Promise<void> => {
    const unknownService: PlatformSessionService =
      new PlatformSessionService(
        new FakeIdentityAccessRepository(null, []),
      );
    const disabledService: PlatformSessionService =
      new PlatformSessionService(
        new FakeIdentityAccessRepository(createMember('disabled'), []),
      );

    const errors: unknown[] = [];
    for (const service of [unknownService, disabledService]) {
      try {
        await service.getSession(identity, NOW);
      } catch (error: unknown) {
        errors.push(error);
      }
    }

    expect(errors).toHaveLength(2);
    expect(errors[0]).toMatchObject({
      code: 'ACCESS_DENIED',
      message: '无权访问当前工作区',
    });
    expect(errors[1]).toMatchObject({
      code: 'ACCESS_DENIED',
      message: '无权访问当前工作区',
    });
  });

  it('does not accept a tenant or member override from callers', async (): Promise<void> => {
    const repository: IdentityAccessRepository =
      new FakeIdentityAccessRepository(
        createMember(),
        createAssignments(['sales']),
      );
    const service: PlatformSessionService =
      new PlatformSessionService(repository);
    const untrustedIdentity: TrustedWebIdentity = {
      feishuTenantKey: 'tenant-b',
      feishuOpenId: 'ou_current_user',
    };

    await expect(
      service.getSession(untrustedIdentity, NOW),
    ).rejects.toMatchObject({ code: 'ACCESS_DENIED' });
  });
});
