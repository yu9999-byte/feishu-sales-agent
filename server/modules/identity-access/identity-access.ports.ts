import type {
  AuthorizationAuditInput,
  PlatformMember,
  ReportingRelation,
  ResourceGrant,
  RoleAssignment,
} from './identity-access.types';

interface PlatformTenant {
  id: string;
  feishuTenantKey: string;
  name: string;
  timezone: string;
  status: 'active' | 'disabled';
}

interface TrustedWebIdentity {
  feishuTenantKey: string;
  feishuOpenId: string;
}

interface IdentityAccessRepository {
  resolveTenantById(tenantId: string): Promise<PlatformTenant | null>;
  resolveTenantByFeishuKey(
    feishuTenantKey: string,
  ): Promise<PlatformTenant | null>;
  resolveMemberByOpenId(
    tenantId: string,
    feishuOpenId: string,
  ): Promise<PlatformMember | null>;
  resolveMemberById(
    tenantId: string,
    memberId: string,
  ): Promise<PlatformMember | null>;
  updateMemberDisplayName(
    tenantId: string,
    memberId: string,
    displayName: string,
  ): Promise<void>;
  listMembers(tenantId: string): Promise<PlatformMember[]>;
  listRoleAssignments(
    tenantId: string,
    memberId: string,
  ): Promise<RoleAssignment[]>;
  listReportingRelations(
    tenantId: string,
  ): Promise<ReportingRelation[]>;
  listResourceGrants(
    tenantId: string,
    memberId: string,
  ): Promise<ResourceGrant[]>;
  appendAuthorizationAudit(input: AuthorizationAuditInput): Promise<void>;
}

const IDENTITY_ACCESS_REPOSITORY = Symbol(
  'IDENTITY_ACCESS_REPOSITORY',
);

export {
  IDENTITY_ACCESS_REPOSITORY,
};

export type {
  IdentityAccessRepository,
  PlatformTenant,
  TrustedWebIdentity,
};
