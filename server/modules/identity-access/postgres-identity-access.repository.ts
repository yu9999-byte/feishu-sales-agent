import { Inject, Injectable } from '@nestjs/common';

import type { Sql } from 'postgres';
import {
  AGENT_DATABASE,
} from '@server/modules/control-store/postgres-control.store';
import {
  isPlatformPermission,
  isPlatformRole,
} from './authorization-policy.service';
import type {
  IdentityAccessRepository,
  PlatformTenant,
} from './identity-access.ports';
import type {
  AuthorizationAuditInput,
  PlatformMember,
  ReportingRelation,
  ResourceGrant,
  RoleAssignment,
} from './identity-access.types';

interface TenantRow {
  id: string;
  feishu_tenant_key: string;
  name: string;
  timezone: string;
  status: 'active' | 'disabled';
}

interface MemberRow {
  id: string;
  tenant_id: string;
  feishu_open_id: string;
  display_name: string;
  status: 'active' | 'disabled';
}

interface RoleAssignmentRow {
  tenant_id: string;
  member_id: string;
  role: unknown;
  valid_from: Date | string;
  valid_to: Date | string | null;
}

interface ReportingRelationRow {
  tenant_id: string;
  manager_member_id: string;
  report_member_id: string;
  valid_from: Date | string;
  valid_to: Date | string | null;
}

interface ResourceGrantRow {
  tenant_id: string;
  grantee_member_id: string;
  resource_type: string;
  resource_ref: string;
  permission: unknown;
  valid_from: Date | string;
  valid_to: Date | string | null;
}

const toDate = (value: Date | string): Date =>
  value instanceof Date ? value : new Date(value);

const toOptionalDate = (value: Date | string | null): Date | null =>
  value === null ? null : toDate(value);

@Injectable()
class PostgresIdentityAccessRepository
implements IdentityAccessRepository {
  constructor(
    @Inject(AGENT_DATABASE)
    private readonly sql: Sql,
  ) {}

  async resolveTenantById(
    tenantId: string,
  ): Promise<PlatformTenant | null> {
    const rows: TenantRow[] = await this.sql<TenantRow[]>`
      SELECT id, feishu_tenant_key, name, timezone, status
      FROM agent_tenants
      WHERE id = ${tenantId}::uuid
      LIMIT 1
    `;
    return this.mapTenant(rows[0]);
  }

  async resolveTenantByFeishuKey(
    feishuTenantKey: string,
  ): Promise<PlatformTenant | null> {
    const rows: TenantRow[] = await this.sql<TenantRow[]>`
      SELECT id, feishu_tenant_key, name, timezone, status
      FROM agent_tenants
      WHERE feishu_tenant_key = ${feishuTenantKey}
      LIMIT 1
    `;
    return this.mapTenant(rows[0]);
  }

  async resolveMemberByOpenId(
    tenantId: string,
    feishuOpenId: string,
  ): Promise<PlatformMember | null> {
    const rows: MemberRow[] = await this.sql<MemberRow[]>`
      SELECT id, tenant_id, feishu_open_id, display_name, status
      FROM tenant_members
      WHERE tenant_id = ${tenantId}::uuid
        AND feishu_open_id = ${feishuOpenId}
      LIMIT 1
    `;
    const row: MemberRow | undefined = rows[0];
    return row === undefined ? null : this.mapMember(row);
  }

  async resolveMemberById(
    tenantId: string,
    memberId: string,
  ): Promise<PlatformMember | null> {
    const rows: MemberRow[] = await this.sql<MemberRow[]>`
      SELECT id, tenant_id, feishu_open_id, display_name, status
      FROM tenant_members
      WHERE tenant_id = ${tenantId}::uuid
        AND id = ${memberId}::uuid
      LIMIT 1
    `;
    const row: MemberRow | undefined = rows[0];
    return row === undefined ? null : this.mapMember(row);
  }

  async updateMemberDisplayName(
    tenantId: string,
    memberId: string,
    displayName: string,
  ): Promise<void> {
    await this.sql`
      UPDATE tenant_members
      SET display_name = ${displayName}, updated_at = CURRENT_TIMESTAMP
      WHERE tenant_id = ${tenantId}::uuid
        AND id = ${memberId}::uuid
    `;
  }

  async listMembers(tenantId: string): Promise<PlatformMember[]> {
    const rows: MemberRow[] = await this.sql<MemberRow[]>`
      SELECT id, tenant_id, feishu_open_id, display_name, status
      FROM tenant_members
      WHERE tenant_id = ${tenantId}::uuid
      ORDER BY created_at ASC, id ASC
    `;
    return rows.map(
      (row: MemberRow): PlatformMember => this.mapMember(row),
    );
  }

  async listRoleAssignments(
    tenantId: string,
    memberId: string,
  ): Promise<RoleAssignment[]> {
    const rows: RoleAssignmentRow[] =
      await this.sql<RoleAssignmentRow[]>`
        SELECT tenant_id, member_id, role, valid_from, valid_to
        FROM role_assignments
        WHERE tenant_id = ${tenantId}::uuid
          AND member_id = ${memberId}::uuid
        ORDER BY created_at ASC, id ASC
      `;
    return rows.map(
      (row: RoleAssignmentRow): RoleAssignment => {
        if (!isPlatformRole(row.role)) {
          throw new Error('Invalid stored platform role');
        }
        return {
        tenantId: row.tenant_id,
        memberId: row.member_id,
        role: row.role,
        validFrom: toDate(row.valid_from),
        validTo: toOptionalDate(row.valid_to),
        };
      },
    );
  }

  async listReportingRelations(
    tenantId: string,
  ): Promise<ReportingRelation[]> {
    const rows: ReportingRelationRow[] =
      await this.sql<ReportingRelationRow[]>`
        SELECT
          tenant_id,
          manager_member_id,
          report_member_id,
          valid_from,
          valid_to
        FROM reporting_relations
        WHERE tenant_id = ${tenantId}::uuid
        ORDER BY created_at ASC, id ASC
      `;
    return rows.map(
      (row: ReportingRelationRow): ReportingRelation => ({
        tenantId: row.tenant_id,
        managerMemberId: row.manager_member_id,
        reportMemberId: row.report_member_id,
        validFrom: toDate(row.valid_from),
        validTo: toOptionalDate(row.valid_to),
      }),
    );
  }

  async listResourceGrants(
    tenantId: string,
    memberId: string,
  ): Promise<ResourceGrant[]> {
    const rows: ResourceGrantRow[] =
      await this.sql<ResourceGrantRow[]>`
        SELECT
          tenant_id,
          grantee_member_id,
          resource_type,
          resource_ref,
          permission,
          valid_from,
          valid_to
        FROM resource_grants
        WHERE tenant_id = ${tenantId}::uuid
          AND grantee_member_id = ${memberId}::uuid
        ORDER BY created_at ASC, id ASC
      `;
    return rows.map(
      (row: ResourceGrantRow): ResourceGrant => {
        if (!isPlatformPermission(row.permission)) {
          throw new Error('Invalid stored platform permission');
        }
        return {
        tenantId: row.tenant_id,
        granteeMemberId: row.grantee_member_id,
        resourceType: row.resource_type,
        resourceRef: row.resource_ref,
        permission: row.permission,
        validFrom: toDate(row.valid_from),
        validTo: toOptionalDate(row.valid_to),
        };
      },
    );
  }

  async appendAuthorizationAudit(input: AuthorizationAuditInput): Promise<void> {
    await this.sql`
      INSERT INTO platform_audit_events (
        tenant_id, trace_id, actor_member_id, role_snapshot, action,
        resource_type, resource_ref_hash, outcome, reason_code,
        policy_version, occurred_at
      ) VALUES (
        ${input.tenantId}::uuid,
        ${input.traceId},
        ${input.actorMemberId}::uuid,
        ${this.sql.json(input.roleSnapshot)},
        ${input.action},
        ${input.resourceType},
        ${input.resourceRefHash},
        ${input.outcome},
        ${input.reasonCode},
        ${input.policyVersion},
        ${input.occurredAt}::timestamptz
      )
    `;
  }

  private mapMember(row: MemberRow): PlatformMember {
    return {
      id: row.id,
      tenantId: row.tenant_id,
      feishuOpenId: row.feishu_open_id,
      displayName: row.display_name,
      status: row.status,
    };
  }

  private mapTenant(
    row: TenantRow | undefined,
  ): PlatformTenant | null {
    if (row === undefined) {
      return null;
    }
    return {
      id: row.id,
      feishuTenantKey: row.feishu_tenant_key,
      name: row.name,
      timezone: row.timezone,
      status: row.status,
    };
  }
}

export { PostgresIdentityAccessRepository };
