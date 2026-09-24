import { describe, expect, it } from 'vitest';

import {
  PlatformShellService,
} from '@server/modules/platform-shell/platform-shell.service';
import {
  AuthorizationPolicyService,
} from '@server/modules/identity-access/authorization-policy.service';
import type {
  AuthorizationAuditInput,
  PlatformMember,
  ReportingRelation,
  ResourceGrant,
  RoleAssignment,
} from '@server/modules/identity-access/identity-access.types';
import type {
  IdentityAccessRepository,
  PlatformTenant,
} from '@server/modules/identity-access/identity-access.ports';
import type {
  AuthenticatedWebSession,
} from '@server/modules/web-auth/web-auth.ports';

const TENANT_ID: string = '00000000-0000-4000-8000-00000000000a';
const MEMBER_ID: string = '00000000-0000-4000-8000-00000000000b';
const member: PlatformMember = {
  id: MEMBER_ID,
  tenantId: TENANT_ID,
  feishuOpenId: 'ou_sales',
  displayName: '季然',
  status: 'active',
};

class StubRepository implements IdentityAccessRepository {
  audits: AuthorizationAuditInput[] = [];
  roles: RoleAssignment[] = [{
    tenantId: TENANT_ID,
    memberId: MEMBER_ID,
    role: 'sales',
    validFrom: new Date('2026-01-01T00:00:00+08:00'),
    validTo: null,
  }];

  async resolveTenantById(): Promise<PlatformTenant | null> {
    return {
      id: TENANT_ID,
      feishuTenantKey: 'tenant-a',
      name: '示范企业',
      timezone: 'Asia/Shanghai',
      status: 'active',
    };
  }

  async resolveTenantByFeishuKey(): Promise<PlatformTenant | null> {
    return this.resolveTenantById();
  }

  async resolveMemberByOpenId(): Promise<PlatformMember | null> {
    return structuredClone(member);
  }

  async resolveMemberById(): Promise<PlatformMember | null> {
    return structuredClone(member);
  }

  async updateMemberDisplayName(): Promise<void> {}

  async listMembers(): Promise<PlatformMember[]> {
    return [structuredClone(member)];
  }

  async listRoleAssignments(): Promise<RoleAssignment[]> {
    return structuredClone(this.roles);
  }

  async listReportingRelations(): Promise<ReportingRelation[]> {
    return [];
  }

  async listResourceGrants(): Promise<ResourceGrant[]> {
    return [];
  }

  async appendAuthorizationAudit(input: AuthorizationAuditInput): Promise<void> {
    this.audits.push(structuredClone(input));
  }
}

const webSession: AuthenticatedWebSession = {
  tenantId: TENANT_ID,
  member,
  tokenHash: 'opaque-session-hash',
};

describe('PlatformShellService', (): void => {
  it('shows an honest partial workspace without fabricated counts', async (): Promise<void> => {
    const repository: StubRepository = new StubRepository();
    const service: PlatformShellService = new PlatformShellService(
      repository,
      new AuthorizationPolicyService(),
    );

    await expect(service.getWorkspace(webSession)).resolves.toMatchObject({
      status: 'partial',
      counters: {
        pendingFollowups: null,
        dueTasks: null,
        openRisks: null,
      },
      unavailableSources: [
        'followup-summary',
        'task-summary',
        'risk-summary',
      ],
    });
  });

  it('rejects a sales user from manager and admin sections', async (): Promise<void> => {
    const repository: StubRepository = new StubRepository();
    const service: PlatformShellService = new PlatformShellService(
      repository,
      new AuthorizationPolicyService(),
    );

    await expect(
      service.getSection(webSession, 'reviews-team'),
    ).rejects.toMatchObject({
      code: 'ACCESS_DENIED',
      message: '无权访问当前工作区',
    });
    await expect(
      service.getSection(webSession, 'admin-members'),
    ).rejects.toMatchObject({ code: 'ACCESS_DENIED' });
    expect(repository.audits).toMatchObject([
      { tenantId: TENANT_ID, action: 'review:read-team', outcome: 'denied' },
      { tenantId: TENANT_ID, action: 'admin:manage-members', outcome: 'denied' },
    ]);
    expect(repository.audits.every((audit): boolean =>
      audit.traceId.length > 0 && audit.policyVersion === 'platform-authz-v1',
    )).toBe(true);
  });

  it('re-evaluates roles for each request and never trusts UI navigation', async (): Promise<void> => {
    const repository: StubRepository = new StubRepository();
    const service: PlatformShellService = new PlatformShellService(
      repository,
      new AuthorizationPolicyService(),
    );
    repository.roles = [{
      tenantId: TENANT_ID,
      memberId: MEMBER_ID,
      role: 'manager',
      validFrom: new Date('2026-01-01T00:00:00+08:00'),
      validTo: null,
    }];

    await expect(
      service.getSection(webSession, 'reviews-team'),
    ).resolves.toMatchObject({
      title: '团队 Review',
      status: 'planned',
    });
    repository.roles = [];
    await expect(
      service.getSection(webSession, 'reviews-team'),
    ).rejects.toMatchObject({ code: 'ACCESS_DENIED' });
  });

  it('rejects cross-tenant session data with the same safe error', async (): Promise<void> => {
    const repository: StubRepository = new StubRepository();
    const service: PlatformShellService = new PlatformShellService(
      repository,
      new AuthorizationPolicyService(),
    );
    const forged: AuthenticatedWebSession = {
      ...webSession,
      tenantId: '00000000-0000-4000-8000-00000000000c',
    };

    await expect(
      service.getSection(forged, 'customers'),
    ).rejects.toMatchObject({ code: 'ACCESS_DENIED' });
  });
});
