import type {
  PlatformDataScope,
  PlatformPermission,
  PlatformRole,
} from '@shared/api.interface';

interface PlatformMember {
  id: string;
  tenantId: string;
  feishuOpenId: string;
  displayName: string;
  status: 'active' | 'disabled';
}

interface RoleAssignment {
  tenantId: string;
  memberId: string;
  role: PlatformRole;
  validFrom: Date;
  validTo: Date | null;
}

interface ReportingRelation {
  tenantId: string;
  managerMemberId: string;
  reportMemberId: string;
  validFrom: Date;
  validTo: Date | null;
}

interface ResourceGrant {
  tenantId: string;
  granteeMemberId: string;
  resourceType: string;
  resourceRef: string;
  permission: PlatformPermission;
  validFrom: Date;
  validTo: Date | null;
}

interface AuthorizationRequest {
  tenantId: string;
  actorMemberId: string;
  action: PlatformPermission;
  resourceType: string;
  resourceTenantId: string;
  resourceOwnerMemberId?: string;
  resourceRef?: string;
  occurredAt: Date;
}

interface AuthorizationInput {
  request: AuthorizationRequest;
  members: PlatformMember[];
  assignments: RoleAssignment[];
  relations: ReportingRelation[];
  grants: ResourceGrant[];
  policyVersion: string;
}

type AuthorizationReasonCode =
  | 'allowed'
  | 'tenant-mismatch'
  | 'membership-inactive'
  | 'permission-missing'
  | 'outside-data-scope'
  | 'grant-expired';

interface AuthorizationDecision {
  allowed: boolean;
  reasonCode: AuthorizationReasonCode;
  publicReason: 'access-denied' | null;
  effectiveRoles: PlatformRole[];
  dataScope: PlatformDataScope;
  policyVersion: string;
  diagnostics: string[];
}

interface AuthorizationAuditInput {
  tenantId: string;
  traceId: string;
  actorMemberId: string | null;
  roleSnapshot: PlatformRole[];
  action: PlatformPermission;
  resourceType: string;
  resourceRefHash: string | null;
  outcome: 'allowed' | 'denied';
  reasonCode: AuthorizationReasonCode;
  policyVersion: string;
  occurredAt: string;
}

interface CreateAuthorizationAuditInput {
  request: AuthorizationRequest;
  decision: AuthorizationDecision;
  traceId: string;
  roleSnapshot: PlatformRole[];
  sensitiveContext?: Record<string, unknown>;
}

export type {
  AuthorizationAuditInput,
  AuthorizationDecision,
  AuthorizationInput,
  AuthorizationReasonCode,
  AuthorizationRequest,
  CreateAuthorizationAuditInput,
  PlatformMember,
  ReportingRelation,
  ResourceGrant,
  RoleAssignment,
};
