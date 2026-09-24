import { Inject, Injectable } from '@nestjs/common';

import type {
  PlatformNavigationItem,
  PlatformPermission,
  PlatformRole,
  PlatformSessionResponse,
} from '@shared/api.interface';
import {
  getPermissionsForRoles,
  isPlatformRole,
} from '@server/modules/identity-access/authorization-policy.service';
import {
  IDENTITY_ACCESS_REPOSITORY,
  type IdentityAccessRepository,
  type PlatformTenant,
  type TrustedWebIdentity,
} from '@server/modules/identity-access/identity-access.ports';
import type {
  PlatformMember,
  RoleAssignment,
} from '@server/modules/identity-access/identity-access.types';

interface NavigationDefinition extends PlatformNavigationItem {
  requiredPermission: PlatformPermission;
}

const POLICY_VERSION = 'platform-authz-v1';

const NAVIGATION_DEFINITIONS: NavigationDefinition[] = [
  {
    key: 'workspace',
    label: '工作台',
    path: '/',
    requiredPermission: 'workspace:view',
  },
  {
    key: 'customers',
    label: '客户',
    path: '/customers',
    requiredPermission: 'customer:read',
  },
  {
    key: 'opportunities',
    label: '商机',
    path: '/opportunities',
    requiredPermission: 'opportunity:read',
  },
  {
    key: 'followups',
    label: '跟进',
    path: '/followups',
    requiredPermission: 'followup:read',
  },
  {
    key: 'tasks',
    label: '任务',
    path: '/tasks',
    requiredPermission: 'task:read',
  },
  {
    key: 'reviews',
    label: 'Review',
    path: '/reviews/team',
    requiredPermission: 'review:read-team',
  },
  {
    key: 'analytics',
    label: '经营看板',
    path: '/analytics',
    requiredPermission: 'analytics:read',
  },
  {
    key: 'playbooks',
    label: '知识与打法',
    path: '/playbooks',
    requiredPermission: 'playbook:read',
  },
  {
    key: 'admin',
    label: '管理',
    path: '/admin/members',
    requiredPermission: 'admin:manage-members',
  },
];

const isActiveAssignment = (
  assignment: RoleAssignment,
  occurredAt: Date,
): boolean =>
  assignment.validFrom.getTime() <= occurredAt.getTime() &&
  (assignment.validTo === null ||
    assignment.validTo.getTime() > occurredAt.getTime());

class PlatformAccessDeniedError extends Error {
  readonly code = 'ACCESS_DENIED' as const;

  constructor() {
    super('无权访问当前工作区');
    this.name = 'PlatformAccessDeniedError';
  }
}

@Injectable()
class PlatformSessionService {
  constructor(
    @Inject(IDENTITY_ACCESS_REPOSITORY)
    private readonly repository: IdentityAccessRepository,
  ) {}

  async getSession(
    identity: TrustedWebIdentity,
    occurredAt: Date = new Date(),
  ): Promise<PlatformSessionResponse> {
    const tenant: PlatformTenant | null =
      await this.repository.resolveTenantByFeishuKey(
        identity.feishuTenantKey,
      );
    if (tenant === null || tenant.status !== 'active') {
      throw new PlatformAccessDeniedError();
    }

    const member: PlatformMember | null =
      await this.repository.resolveMemberByOpenId(
        tenant.id,
        identity.feishuOpenId,
      );
    if (member === null || member.status !== 'active') {
      throw new PlatformAccessDeniedError();
    }

    return this.createSession(tenant, member, occurredAt);
  }

  async getSessionByMembership(
    tenantId: string,
    memberId: string,
    occurredAt: Date = new Date(),
  ): Promise<PlatformSessionResponse> {
    const tenant: PlatformTenant | null =
      await this.repository.resolveTenantById(tenantId);
    const member: PlatformMember | null =
      await this.repository.resolveMemberById(tenantId, memberId);
    if (
      tenant === null || tenant.status !== 'active' ||
      member === null || member.status !== 'active' ||
      member.tenantId !== tenantId
    ) {
      throw new PlatformAccessDeniedError();
    }
    return this.createSession(tenant, member, occurredAt);
  }

  private async createSession(
    tenant: PlatformTenant,
    member: PlatformMember,
    occurredAt: Date,
  ): Promise<PlatformSessionResponse> {
    const assignments: RoleAssignment[] =
      await this.repository.listRoleAssignments(
        tenant.id,
        member.id,
      );
    const roles: PlatformRole[] = Array.from(
      new Set<PlatformRole>(
        assignments
          .filter((assignment: RoleAssignment): boolean =>
            isActiveAssignment(assignment, occurredAt),
          )
          .map(
            (assignment: RoleAssignment): PlatformRole =>
              assignment.role,
          ).filter(isPlatformRole),
      ),
    );
    if (roles.length === 0) {
      throw new PlatformAccessDeniedError();
    }

    const permissions: PlatformPermission[] =
      getPermissionsForRoles(roles);
    const navigation: PlatformNavigationItem[] = NAVIGATION_DEFINITIONS
      .filter((definition: NavigationDefinition): boolean =>
        permissions.includes(definition.requiredPermission),
      )
      .map((definition: NavigationDefinition): PlatformNavigationItem => ({
        key: definition.key,
        label: definition.label,
        path: definition.path,
      }));

    return {
      tenant: {
        id: tenant.id,
        name: tenant.name,
        timezone: tenant.timezone,
      },
      member: {
        id: member.id,
        feishuOpenId: member.feishuOpenId,
        displayName: member.displayName,
      },
      roles,
      permissions,
      navigation,
      policyVersion: POLICY_VERSION,
    };
  }
}

export {
  PlatformAccessDeniedError,
  PlatformSessionService,
};
