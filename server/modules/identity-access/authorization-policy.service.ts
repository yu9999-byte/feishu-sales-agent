import { Injectable } from '@nestjs/common';

import type {
  PlatformDataScope,
  PlatformPermission,
  PlatformRole,
} from '@shared/api.interface';
import type {
  AuthorizationDecision,
  AuthorizationInput,
  AuthorizationReasonCode,
  AuthorizationRequest,
  ReportingRelation,
  ResourceGrant,
  RoleAssignment,
} from './identity-access.types';

type RolePolicy = Partial<Record<PlatformPermission, PlatformDataScope>>;

const PERMISSION_ORDER: PlatformPermission[] = [
  'workspace:view',
  'followup:create-own',
  'followup:confirm-own',
  'followup:read',
  'customer:read',
  'opportunity:read',
  'task:read',
  'task:assign',
  'review:read-personal',
  'review:read-team',
  'analytics:read',
  'playbook:read',
  'playbook:review',
  'playbook:publish',
  'admin:manage-members',
  'admin:manage-policies',
  'audit:read',
];

const ROLE_POLICIES: Record<PlatformRole, RolePolicy> = {
  sales: {
    'workspace:view': 'self',
    'followup:create-own': 'self',
    'followup:confirm-own': 'self',
    'followup:read': 'self',
    'customer:read': 'self',
    'opportunity:read': 'self',
    'task:read': 'self',
    'task:assign': 'self',
    'review:read-personal': 'self',
    'analytics:read': 'self',
    'playbook:read': 'tenant',
  },
  manager: {
    'workspace:view': 'team',
    'followup:create-own': 'self',
    'followup:confirm-own': 'self',
    'followup:read': 'team',
    'customer:read': 'team',
    'opportunity:read': 'team',
    'task:read': 'team',
    'task:assign': 'team',
    'review:read-personal': 'team',
    'review:read-team': 'team',
    'analytics:read': 'team',
    'playbook:read': 'tenant',
    'playbook:review': 'tenant',
  },
  executive: {
    'workspace:view': 'tenant',
    'followup:read': 'tenant',
    'customer:read': 'tenant',
    'opportunity:read': 'tenant',
    'task:read': 'tenant',
    'review:read-personal': 'tenant',
    'review:read-team': 'tenant',
    'analytics:read': 'tenant',
    'playbook:read': 'tenant',
    'playbook:review': 'tenant',
  },
  admin: {
    'workspace:view': 'tenant',
    'followup:read': 'tenant',
    'customer:read': 'tenant',
    'opportunity:read': 'tenant',
    'task:read': 'tenant',
    'review:read-personal': 'tenant',
    'review:read-team': 'tenant',
    'analytics:read': 'tenant',
    'playbook:read': 'tenant',
    'playbook:review': 'tenant',
    'playbook:publish': 'tenant',
    'admin:manage-members': 'tenant',
    'admin:manage-policies': 'tenant',
    'audit:read': 'tenant',
  },
};

const isPlatformRole = (value: unknown): value is PlatformRole =>
  typeof value === 'string' &&
  Object.prototype.hasOwnProperty.call(ROLE_POLICIES, value);

const isPlatformPermission = (
  value: unknown,
): value is PlatformPermission =>
  typeof value === 'string' &&
  PERMISSION_ORDER.some((permission): boolean => permission === value);

const SCOPE_RANK: Record<PlatformDataScope, number> = {
  none: 0,
  self: 1,
  granted: 2,
  team: 3,
  tenant: 4,
};

interface TeamScopeResult {
  memberIds: Set<string>;
  hasCycle: boolean;
}

const isActiveAt = (
  validFrom: Date,
  validTo: Date | null,
  occurredAt: Date,
): boolean =>
  validFrom.getTime() <= occurredAt.getTime() &&
  (validTo === null || validTo.getTime() > occurredAt.getTime());

const deniedDecision = (
  input: AuthorizationInput,
  reasonCode: Exclude<AuthorizationReasonCode, 'allowed'>,
  effectiveRoles: PlatformRole[] = [],
  diagnostics: string[] = [],
): AuthorizationDecision => ({
  allowed: false,
  reasonCode,
  publicReason: 'access-denied',
  effectiveRoles,
  dataScope: 'none',
  policyVersion: input.policyVersion,
  diagnostics,
});

const selectScope = (
  roles: PlatformRole[],
  action: PlatformPermission,
): PlatformDataScope => {
  let selectedScope: PlatformDataScope = 'none';
  roles.forEach((role: PlatformRole): void => {
    const candidate: PlatformDataScope | undefined =
      ROLE_POLICIES[role][action];
    if (
      candidate !== undefined &&
      SCOPE_RANK[candidate] > SCOPE_RANK[selectedScope]
    ) {
      selectedScope = candidate;
    }
  });
  return selectedScope;
};

const getPermissionsForRoles = (
  roles: PlatformRole[],
): PlatformPermission[] =>
  PERMISSION_ORDER.filter((permission: PlatformPermission): boolean =>
    roles.filter(isPlatformRole).some((role: PlatformRole): boolean =>
      ROLE_POLICIES[role][permission] !== undefined,
    ),
  );

const collectTeamScope = (
  request: AuthorizationRequest,
  relations: ReportingRelation[],
): TeamScopeResult => {
  const activeRelations: ReportingRelation[] = relations.filter(
    (relation: ReportingRelation): boolean =>
      relation.tenantId === request.tenantId &&
      isActiveAt(
        relation.validFrom,
        relation.validTo,
        request.occurredAt,
      ),
  );
  const directReports: string[] = activeRelations
    .filter((relation: ReportingRelation): boolean =>
      relation.managerMemberId === request.actorMemberId,
    )
    .map((relation: ReportingRelation): string => relation.reportMemberId);
  const discovered: Set<string> = new Set<string>([
    request.actorMemberId,
    ...directReports,
  ]);
  const visiting: Set<string> = new Set<string>();
  const visited: Set<string> = new Set<string>();
  let hasCycle: boolean = false;

  const visit = (managerMemberId: string): void => {
    if (visiting.has(managerMemberId)) {
      hasCycle = true;
      return;
    }
    if (visited.has(managerMemberId)) {
      return;
    }
    visiting.add(managerMemberId);
    const childRelations: ReportingRelation[] = activeRelations.filter(
      (relation: ReportingRelation): boolean =>
        relation.managerMemberId === managerMemberId,
    );
    childRelations.forEach((relation: ReportingRelation): void => {
      discovered.add(relation.reportMemberId);
      visit(relation.reportMemberId);
    });
    visiting.delete(managerMemberId);
    visited.add(managerMemberId);
  };

  visit(request.actorMemberId);
  if (hasCycle) {
    return {
      memberIds: new Set<string>([
        request.actorMemberId,
        ...directReports,
      ]),
      hasCycle: true,
    };
  }
  return { memberIds: discovered, hasCycle: false };
};

const grantMatches = (
  request: AuthorizationRequest,
  grant: ResourceGrant,
): boolean =>
  grant.tenantId === request.tenantId &&
  grant.granteeMemberId === request.actorMemberId &&
  grant.resourceType === request.resourceType &&
  grant.resourceRef === request.resourceRef &&
  grant.permission === request.action;

@Injectable()
class AuthorizationPolicyService {
  authorize(input: AuthorizationInput): AuthorizationDecision {
    const request: AuthorizationRequest = input.request;
    if (request.tenantId !== request.resourceTenantId) {
      return deniedDecision(input, 'tenant-mismatch');
    }

    const memberExists: boolean = input.members.some(
      (member): boolean =>
        member.id === request.actorMemberId &&
        member.tenantId === request.tenantId &&
        member.status === 'active',
    );
    if (!memberExists) {
      return deniedDecision(input, 'membership-inactive');
    }

    const activeAssignments: RoleAssignment[] = input.assignments.filter(
      (assignment: RoleAssignment): boolean =>
        assignment.tenantId === request.tenantId &&
        assignment.memberId === request.actorMemberId &&
        isActiveAt(
          assignment.validFrom,
          assignment.validTo,
          request.occurredAt,
        ),
    );
    const effectiveRoles: PlatformRole[] = Array.from(
      new Set<PlatformRole>(
        activeAssignments.map(
          (assignment: RoleAssignment): PlatformRole => assignment.role,
        ).filter(isPlatformRole),
      ),
    );
    const roleScope: PlatformDataScope = selectScope(
      effectiveRoles,
      request.action,
    );
    if (roleScope === 'none') {
      return deniedDecision(
        input,
        'permission-missing',
        effectiveRoles,
      );
    }

    if (roleScope === 'tenant') {
      return this.allowedDecision(input, effectiveRoles, 'tenant');
    }

    const resourceOwnerMemberId: string | undefined =
      request.resourceOwnerMemberId;
    if (resourceOwnerMemberId === undefined) {
      return this.allowedDecision(input, effectiveRoles, roleScope);
    }
    if (resourceOwnerMemberId === request.actorMemberId) {
      return this.allowedDecision(input, effectiveRoles, roleScope);
    }

    const matchingGrants: ResourceGrant[] = input.grants.filter(
      (grant: ResourceGrant): boolean => grantMatches(request, grant),
    );
    const activeGrant: ResourceGrant | undefined = matchingGrants.find(
      (grant: ResourceGrant): boolean =>
        isActiveAt(grant.validFrom, grant.validTo, request.occurredAt),
    );
    if (activeGrant !== undefined) {
      return this.allowedDecision(input, effectiveRoles, 'granted');
    }

    if (roleScope === 'team') {
      const teamScope: TeamScopeResult = collectTeamScope(
        request,
        input.relations,
      );
      if (teamScope.memberIds.has(resourceOwnerMemberId)) {
        return this.allowedDecision(input, effectiveRoles, 'team',
          teamScope.hasCycle ? ['reporting-cycle'] : []);
      }
      return deniedDecision(
        input,
        'outside-data-scope',
        effectiveRoles,
        teamScope.hasCycle ? ['reporting-cycle'] : [],
      );
    }

    if (matchingGrants.length > 0) {
      return deniedDecision(input, 'grant-expired', effectiveRoles);
    }
    return deniedDecision(input, 'outside-data-scope', effectiveRoles);
  }

  private allowedDecision(
    input: AuthorizationInput,
    effectiveRoles: PlatformRole[],
    dataScope: PlatformDataScope,
    diagnostics: string[] = [],
  ): AuthorizationDecision {
    return {
      allowed: true,
      reasonCode: 'allowed',
      publicReason: null,
      effectiveRoles,
      dataScope,
      policyVersion: input.policyVersion,
      diagnostics,
    };
  }
}

export {
  AuthorizationPolicyService,
  getPermissionsForRoles,
  isPlatformPermission,
  isPlatformRole,
};
