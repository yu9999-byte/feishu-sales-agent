import { randomUUID } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';

import type {
  PlatformPermission,
  PlatformSectionKey,
  PlatformSectionResponse,
  WorkspaceResponse,
} from '@shared/api.interface';
import {
  AuthorizationPolicyService,
} from '@server/modules/identity-access/authorization-policy.service';
import { createAuthorizationAuditInput } from '@server/modules/identity-access/authorization-audit';
import {
  IDENTITY_ACCESS_REPOSITORY,
  type IdentityAccessRepository,
  type PlatformTenant,
} from '@server/modules/identity-access/identity-access.ports';
import type {
  AuthorizationDecision,
  PlatformMember,
  ReportingRelation,
  ResourceGrant,
  RoleAssignment,
} from '@server/modules/identity-access/identity-access.types';
import type {
  AuthenticatedWebSession,
} from '@server/modules/web-auth/web-auth.ports';
import { PlatformAccessDeniedError } from './platform-session.service';

interface SectionDefinition {
  key: PlatformSectionKey;
  title: string;
  phase: PlatformSectionResponse['phase'];
  permission: PlatformPermission;
}

const SECTION_DEFINITIONS: SectionDefinition[] = [
  { key: 'customers', title: '客户', phase: 'C', permission: 'customer:read' },
  { key: 'opportunities', title: '商机', phase: 'C', permission: 'opportunity:read' },
  { key: 'followups', title: '跟进', phase: 'B', permission: 'followup:read' },
  { key: 'tasks', title: '任务', phase: 'B', permission: 'task:read' },
  { key: 'reviews-team', title: '团队 Review', phase: 'E', permission: 'review:read-team' },
  { key: 'analytics', title: '经营看板', phase: 'E', permission: 'analytics:read' },
  { key: 'playbooks', title: '知识与打法', phase: 'F', permission: 'playbook:read' },
  { key: 'admin-members', title: '成员与组织', phase: 'G', permission: 'admin:manage-members' },
  { key: 'admin-audit', title: '审计', phase: 'G', permission: 'audit:read' },
];

@Injectable()
class PlatformShellService {
  constructor(
    @Inject(IDENTITY_ACCESS_REPOSITORY)
    private readonly repository: IdentityAccessRepository,
    private readonly policy: AuthorizationPolicyService,
  ) {}

  async getWorkspace(
    session: AuthenticatedWebSession,
  ): Promise<WorkspaceResponse> {
    await this.assertPermission(session, 'workspace:view');
    return {
      status: 'partial',
      counters: {
        pendingFollowups: null,
        dueTasks: null,
        openRisks: null,
      },
      updatedAt: new Date().toISOString(),
      unavailableSources: [
        'followup-summary',
        'task-summary',
        'risk-summary',
      ],
    };
  }

  async getSection(
    session: AuthenticatedWebSession,
    key: PlatformSectionKey,
  ): Promise<PlatformSectionResponse> {
    const definition: SectionDefinition | undefined =
      SECTION_DEFINITIONS.find(
        (candidate: SectionDefinition): boolean => candidate.key === key,
      );
    if (!definition) {
      throw new PlatformAccessDeniedError();
    }
    await this.assertPermission(session, definition.permission);
    return {
      key: definition.key,
      title: definition.title,
      status: 'planned',
      phase: definition.phase,
      message: '该模块将在对应阶段实现。当前可通过飞书机器人使用 P0 跟进闭环。',
    };
  }

  private async assertPermission(
    session: AuthenticatedWebSession,
    action: PlatformPermission,
  ): Promise<void> {
    const tenant: PlatformTenant | null =
      await this.repository.resolveTenantById(session.tenantId);
    const member: PlatformMember | null =
      await this.repository.resolveMemberById(
        session.tenantId,
        session.member.id,
      );
    const validMembership: boolean =
      tenant?.status === 'active' &&
      member?.status === 'active' &&
      member.tenantId === session.tenantId &&
      member.feishuOpenId === session.member.feishuOpenId;
    if (tenant === null) {
      throw new PlatformAccessDeniedError();
    }
    const assignments: RoleAssignment[] = validMembership
      ? await this.repository.listRoleAssignments(session.tenantId, member.id)
      : [];
    const relations: ReportingRelation[] = validMembership
      ? await this.repository.listReportingRelations(session.tenantId)
      : [];
    const grants: ResourceGrant[] = validMembership
      ? await this.repository.listResourceGrants(session.tenantId, member.id)
      : [];
    const occurredAt: Date = new Date();
    const request = {
      tenantId: session.tenantId,
      actorMemberId: session.member.id,
      action,
      resourceType: 'platform-section',
      resourceTenantId: tenant.id,
      occurredAt,
    };
    const decision: AuthorizationDecision = this.policy.authorize({
      request,
      members: validMembership ? [member] : [],
      assignments,
      relations,
      grants,
      policyVersion: 'platform-authz-v1',
    });
    await this.repository.appendAuthorizationAudit({
      ...createAuthorizationAuditInput({
        request,
        decision,
        traceId: randomUUID(),
        roleSnapshot: decision.effectiveRoles,
      }),
      actorMemberId: member?.id ?? null,
    });
    if (
      !validMembership || !decision.allowed
    ) {
      throw new PlatformAccessDeniedError();
    }
  }
}

export { PlatformShellService };
