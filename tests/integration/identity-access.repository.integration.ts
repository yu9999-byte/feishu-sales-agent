import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { config as loadEnvironment } from 'dotenv';
import postgres from 'postgres';

import type { Sql } from 'postgres';
import {
  PostgresIdentityAccessRepository,
} from '@server/modules/identity-access/postgres-identity-access.repository';
import { PostgresWebAuthStore } from '@server/modules/web-auth/postgres-web-auth.store';
import { PostgresFollowupDraftRepository } from '@server/modules/sales-behavior/postgres-followup-draft.repository';
import { FollowupQualityService } from '@server/modules/sales-behavior/followup-quality.service';
import { FollowupProgressService } from '@server/modules/sales-behavior/followup-progress.service';
import { PostgresControlStore } from '@server/modules/control-store/postgres-control.store';
import type {
  SalesContext,
} from '@shared/api.interface';
import type {
  PlatformTenant,
} from '@server/modules/identity-access/identity-access.ports';
import type {
  PlatformMember,
  ReportingRelation,
  ResourceGrant,
  RoleAssignment,
} from '@server/modules/identity-access/identity-access.types';

loadEnvironment({
  path: ['.env.local', '.env'],
  quiet: true,
});

const TENANT_A: string = '10000000-0000-4000-8000-00000000000a';
const TENANT_B: string = '10000000-0000-4000-8000-00000000000b';
const MEMBER_A: string = '20000000-0000-4000-8000-00000000000a';
const MEMBER_B: string = '20000000-0000-4000-8000-00000000000b';
const MANAGER_A: string = '20000000-0000-4000-8000-00000000000c';

const databaseUrl: string | undefined = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error('DATABASE_URL is required for identity integration tests');
}

const sql: Sql = postgres(databaseUrl, {
  max: 2,
  connect_timeout: 10,
  idle_timeout: 5,
  onnotice: (): void => undefined,
});

const deleteFixtureTenants = async (): Promise<void> => {
  await sql`
    DELETE FROM agent_tenants
    WHERE id IN (${TENANT_A}::uuid, ${TENANT_B}::uuid)
  `;
};

describe('PostgresIdentityAccessRepository', (): void => {
  beforeAll(async (): Promise<void> => {
    await deleteFixtureTenants();
    await sql`
      INSERT INTO agent_tenants (
        id,
        feishu_tenant_key,
        name,
        status,
        timezone
      ) VALUES
        (
          ${TENANT_A}::uuid,
          'integration-tenant-a',
          '集成测试企业 A',
          'active',
          'Asia/Shanghai'
        ),
        (
          ${TENANT_B}::uuid,
          'integration-tenant-b',
          '集成测试企业 B',
          'active',
          'Asia/Shanghai'
        )
    `;
    await sql`
      INSERT INTO tenant_members (
        tenant_id,
        id,
        feishu_open_id,
        display_name,
        status
      ) VALUES
        (
          ${TENANT_A}::uuid,
          ${MEMBER_A}::uuid,
          'ou_shared_user',
          '测试销售 A',
          'active'
        ),
        (
          ${TENANT_B}::uuid,
          ${MEMBER_B}::uuid,
          'ou_shared_user',
          '测试管理员 B',
          'active'
        ),
        (
          ${TENANT_A}::uuid,
          ${MANAGER_A}::uuid,
          'ou_manager_a',
          '测试主管 A',
          'active'
        )
    `;
    await sql`
      INSERT INTO role_assignments (
        tenant_id,
        member_id,
        role,
        valid_from
      ) VALUES
        (${TENANT_A}::uuid, ${MEMBER_A}::uuid, 'sales', CURRENT_TIMESTAMP),
        (${TENANT_B}::uuid, ${MEMBER_B}::uuid, 'admin', CURRENT_TIMESTAMP),
        (${TENANT_A}::uuid, ${MANAGER_A}::uuid, 'manager', CURRENT_TIMESTAMP)
    `;
    await sql`
      INSERT INTO reporting_relations (
        tenant_id,
        manager_member_id,
        report_member_id,
        source,
        valid_from
      ) VALUES (
        ${TENANT_A}::uuid,
        ${MANAGER_A}::uuid,
        ${MEMBER_A}::uuid,
        'integration-test',
        CURRENT_TIMESTAMP
      )
    `;
    await sql`
      INSERT INTO resource_grants (
        tenant_id,
        grantee_member_id,
        resource_type,
        resource_ref,
        permission,
        grantor_member_id,
        reason,
        valid_from
      ) VALUES (
        ${TENANT_A}::uuid,
        ${MEMBER_A}::uuid,
        'customer',
        'customer-shared',
        'customer:read',
        ${MANAGER_A}::uuid,
        '集成测试共享',
        CURRENT_TIMESTAMP
      )
    `;
  });

  afterAll(async (): Promise<void> => {
    await deleteFixtureTenants();
    await sql.end({ timeout: 5 });
  });

  it('resolves the same Feishu open ID inside each tenant only', async (): Promise<void> => {
    const repository: PostgresIdentityAccessRepository =
      new PostgresIdentityAccessRepository(sql);
    const tenantA: PlatformTenant | null =
      await repository.resolveTenantByFeishuKey('integration-tenant-a');
    const tenantB: PlatformTenant | null =
      await repository.resolveTenantByFeishuKey('integration-tenant-b');
    const memberA: PlatformMember | null =
      await repository.resolveMemberByOpenId(
        TENANT_A,
        'ou_shared_user',
      );
    const memberB: PlatformMember | null =
      await repository.resolveMemberByOpenId(
        TENANT_B,
        'ou_shared_user',
      );

    expect(tenantA?.id).toBe(TENANT_A);
    expect(tenantB?.id).toBe(TENANT_B);
    expect(memberA?.id).toBe(MEMBER_A);
    expect(memberB?.id).toBe(MEMBER_B);
    expect(memberA?.displayName).toBe('测试销售 A');
    expect(memberB?.displayName).toBe('测试管理员 B');
  });

  it('persists an isolated intent-clarification session with a null draft', async (): Promise<void> => {
    const control: PostgresControlStore = new PostgresControlStore(sql);
    const expiresAt: Date = new Date(Date.now() + 30 * 60 * 1_000);

    await control.saveIntentClarificationSession({
      tenantId: TENANT_A,
      actorOpenId: 'ou_clarification_user',
      chatId: 'oc_tenant_a_chat',
      sourceMessageId: 'om_original_message',
      rawText: '客户希望下周确认预算。',
      expiresAt,
    });

    await expect(control.getOpenSession(
      TENANT_A,
      'ou_clarification_user',
    )).resolves.toMatchObject({
      tenantId: TENANT_A,
      actorOpenId: 'ou_clarification_user',
      chatId: 'oc_tenant_a_chat',
      sourceMessageId: 'om_original_message',
      rawText: '客户希望下周确认预算。',
      draft: null,
      state: 'collecting',
    });
    await expect(control.getOpenSession(
      TENANT_B,
      'ou_clarification_user',
    )).resolves.toBeNull();
  });

  it('returns tenant-scoped roles, relations and grants', async (): Promise<void> => {
    const repository: PostgresIdentityAccessRepository =
      new PostgresIdentityAccessRepository(sql);
    const assignmentsA: RoleAssignment[] =
      await repository.listRoleAssignments(TENANT_A, MEMBER_A);
    const assignmentsB: RoleAssignment[] =
      await repository.listRoleAssignments(TENANT_B, MEMBER_B);
    const relationsA: ReportingRelation[] =
      await repository.listReportingRelations(TENANT_A);
    const grantsA: ResourceGrant[] =
      await repository.listResourceGrants(TENANT_A, MEMBER_A);

    expect(assignmentsA.map((item: RoleAssignment) => item.role)).toEqual([
      'sales',
    ]);
    expect(assignmentsB.map((item: RoleAssignment) => item.role)).toEqual([
      'admin',
    ]);
    expect(relationsA).toHaveLength(1);
    expect(relationsA[0]).toMatchObject({
      managerMemberId: MANAGER_A,
      reportMemberId: MEMBER_A,
    });
    expect(grantsA).toHaveLength(1);
    expect(grantsA[0]).toMatchObject({
      resourceRef: 'customer-shared',
      permission: 'customer:read',
    });
  });

  it('never returns another tenant when IDs do not match', async (): Promise<void> => {
    const repository: PostgresIdentityAccessRepository =
      new PostgresIdentityAccessRepository(sql);

    await expect(
      repository.resolveMemberByOpenId(
        TENANT_A,
        'missing-open-id',
      ),
    ).resolves.toBeNull();
    await expect(
      repository.listRoleAssignments(TENANT_A, MEMBER_B),
    ).resolves.toEqual([]);
    await expect(
      repository.listResourceGrants(TENANT_B, MEMBER_A),
    ).resolves.toEqual([]);
  });

  it('appends tenant-scoped authorization audits without raw resource identifiers', async (): Promise<void> => {
    const repository = new PostgresIdentityAccessRepository(sql);
    const audit = {
      tenantId: TENANT_A,
      traceId: 'integration-trace',
      actorMemberId: MEMBER_A,
      roleSnapshot: ['sales'] as const,
      action: 'customer:read' as const,
      resourceType: 'customer',
      resourceRefHash: 'a'.repeat(64),
      outcome: 'denied' as const,
      reasonCode: 'outside-data-scope' as const,
      policyVersion: 'platform-authz-v1',
      occurredAt: new Date().toISOString(),
    };
    await repository.appendAuthorizationAudit({
      ...audit,
      roleSnapshot: [...audit.roleSnapshot],
    });
    await repository.appendAuthorizationAudit({
      ...audit,
      roleSnapshot: [...audit.roleSnapshot],
    });
    const rows = await sql`
      SELECT outcome, reason_code, resource_ref_hash
      FROM platform_audit_events
      WHERE tenant_id = ${TENANT_A}::uuid
        AND trace_id = 'integration-trace'
    `;
    const otherTenantRows = await sql`
      SELECT id FROM platform_audit_events
      WHERE tenant_id = ${TENANT_B}::uuid
        AND trace_id = 'integration-trace'
    `;
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      reason_code: 'outside-data-scope',
      resource_ref_hash: 'a'.repeat(64),
    });
    expect(otherTenantRows).toHaveLength(0);
  });

  it('consumes login state once and isolates session hashes by tenant', async (): Promise<void> => {
    const store = new PostgresWebAuthStore(sql);
    const expiresAt = new Date(Date.now() + 60_000);
    const now = new Date();
    const stateHash = 'b'.repeat(64);
    const tokenHash = 'c'.repeat(64);
    await store.saveLoginState({
      tenantId: TENANT_A,
      stateHash,
      redirectPath: '/customers',
      expiresAt,
    });
    await store.saveSession({
      tenantId: TENANT_A,
      tokenHash,
      memberId: MEMBER_A,
      expiresAt,
    });
    await expect(store.consumeLoginState(TENANT_B, stateHash, now))
      .resolves.toBeNull();
    await expect(store.getSession(TENANT_B, tokenHash, now))
      .resolves.toBeNull();
    await expect(store.consumeLoginState(TENANT_A, stateHash, now))
      .resolves.toMatchObject({ redirectPath: '/customers' });
    await expect(store.consumeLoginState(TENANT_A, stateHash, now))
      .resolves.toBeNull();
    await expect(store.getSession(TENANT_A, tokenHash, now))
      .resolves.toMatchObject({ memberId: MEMBER_A });
    await store.revokeSession(TENANT_A, tokenHash);
    await expect(store.getSession(TENANT_A, tokenHash, now))
      .resolves.toBeNull();
  });

  it('persists idempotent draft creation and optimistic immutable edits', async (): Promise<void> => {
    const repository = new PostgresFollowupDraftRepository(sql);
    const draft = {
      customerName: '北辰制造',
      contactName: '张总',
      opportunityName: '数字化项目',
      summary: '客户认可试点方案。',
      customerNeeds: ['华东工厂先试点'],
      objections: [],
      risks: [],
      progress: '方案已认可',
      expectedAmount: 500000,
      nextAction: '发送实施计划',
      dueAt: '2026-09-20T18:00:00+08:00',
      evidenceQuotes: ['客户认可试点方案'],
    };
    const quality = new FollowupQualityService().review({
      sourceText: '北辰制造客户认可试点方案。',
      generatedBody: '北辰制造客户认可试点方案。下一步发送实施计划。',
      draft,
      communicationMethod: null,
      communicationAt: null,
      topic: '数字化项目',
      agreements: [],
      decisionChain: [],
      competitors: [],
      nextActionOwner: null,
      nextActionParticipants: [],
      evidence: [{ field: 'summary', assertionKind: 'fact', quote: '客户认可试点方案' }],
    });
    const salesContext: SalesContext = {
      status: 'partial',
      customer: {
        name: '北辰制造',
        contactName: '张总',
        latestSummary: '认可方案',
        lastFollowupAt: null,
        source: {
          recordId: 'customer-1',
          recordUrl: 'https://feishu.cn/customer-1',
          sourceVersion: '2026-09-25T01:00:00.000Z',
        },
      },
      customerCandidates: [],
      opportunities: [],
      recentFollowups: [],
      conflicts: [],
      tasks: [],
      warnings: ['task_context_unavailable'],
      readAt: '2026-09-25T02:00:00.000Z',
    };
    const sourceText: string = '北辰制造客户认可试点方案。';
    const progressAssessment = new FollowupProgressService().assess({
      draft,
      salesContext,
      sourceText,
      now: new Date(),
    });
    const input = {
      tenantId: TENANT_A,
      ownerMemberId: MEMBER_A,
      sourceType: 'text' as const,
      idempotencyKey: 'integration-draft-1',
      sourceText,
      generatedBody: '北辰制造客户认可试点方案。下一步发送实施计划。',
      draft,
      quality,
      salesContext,
      progressAssessment,
      createdAt: new Date(),
    };
    const first = await repository.createGeneratedDraft(input);
    const repeated = await repository.createGeneratedDraft(input);
    expect(repeated.id).toBe(first.id);
    expect(first.version.salesContext).toEqual(salesContext);
    expect(first.version.progressAssessment).toEqual(progressAssessment);
    const editedDraft = {
      ...draft,
      nextAction: '发送实施计划并约张总复盘',
    };
    const editedProgressAssessment = new FollowupProgressService().assess({
      draft: editedDraft,
      salesContext,
      sourceText,
      now: new Date(),
    });
    const edited = await repository.appendUserEdit({
      tenantId: TENANT_A,
      draftId: first.id,
      ownerMemberId: MEMBER_A,
      expectedVersion: 1,
      generatedBody: `${input.generatedBody} 已约张总复盘。`,
      draft: editedDraft,
      quality,
      progressAssessment: editedProgressAssessment,
      createdAt: new Date(),
    });
    expect(edited).toMatchObject({ currentVersion: 2 });
    expect(edited?.version.salesContext).toEqual(salesContext);
    expect(edited?.version.progressAssessment).toEqual(editedProgressAssessment);
    expect(edited?.version.progressAssessment).not.toEqual(progressAssessment);
    await expect(repository.appendUserEdit({
      tenantId: TENANT_A,
      draftId: first.id,
      ownerMemberId: MEMBER_A,
      expectedVersion: 1,
      generatedBody: input.generatedBody,
      draft,
      quality,
      progressAssessment,
      createdAt: new Date(),
    })).resolves.toBeNull();
    const versions = await sql`
      SELECT version, creation_kind
      FROM followup_draft_versions
      WHERE tenant_id = ${TENANT_A}::uuid AND draft_id = ${first.id}::uuid
      ORDER BY version
    `;
    expect(versions).toMatchObject([
      { version: 1, creation_kind: 'generated' },
      { version: 2, creation_kind: 'user_edit' },
    ]);
    const confirmed = await repository.markConfirmed({
      tenantId: TENANT_A,
      draftId: first.id,
      ownerMemberId: MEMBER_A,
      expectedVersion: 2,
      confirmedAt: new Date(),
    });
    expect(confirmed).toMatchObject({
      status: 'confirmed',
      currentVersion: 3,
      version: { version: 3, creationKind: 'confirmed' },
    });
    expect(confirmed?.version.salesContext).toEqual(salesContext);
    expect(confirmed?.version.progressAssessment).toEqual(
      editedProgressAssessment,
    );
    await expect(repository.markConfirmed({
      tenantId: TENANT_A,
      draftId: first.id,
      ownerMemberId: MEMBER_A,
      expectedVersion: 2,
      confirmedAt: new Date(),
    })).resolves.toBeNull();
    await expect(repository.getDraft(TENANT_B, first.id)).resolves.toBeNull();
  });

  it('returns one draft to concurrent submissions with the same idempotency key', async (): Promise<void> => {
    const repository = new PostgresFollowupDraftRepository(sql);
    const draft = {
      customerName: '并发客户', contactName: null, opportunityName: null,
      summary: '已沟通', customerNeeds: [], objections: [], risks: [],
      progress: null, expectedAmount: null, nextAction: '发送方案',
      dueAt: '2026-09-20T18:00:00+08:00', evidenceQuotes: [],
    };
    const quality = new FollowupQualityService().review({
      sourceText: '并发客户已沟通，发送方案', generatedBody: '并发客户已沟通，发送方案',
      draft, communicationMethod: null, communicationAt: null,
      topic: null, agreements: [], decisionChain: [], competitors: [],
      nextActionOwner: null, nextActionParticipants: [], evidence: [],
    });
    const input = {
      tenantId: TENANT_A, ownerMemberId: MEMBER_A,
      sourceType: 'text' as const, idempotencyKey: 'concurrent-draft',
      sourceText: '并发客户已沟通，发送方案', generatedBody: '并发客户已沟通，发送方案',
      draft, quality, createdAt: new Date(),
    };
    const results = await Promise.all([
      repository.createGeneratedDraft(input),
      repository.createGeneratedDraft(input),
    ]);
    expect(results[0].id).toBe(results[1].id);
    const rows = await sql`
      SELECT count(*)::integer AS count FROM followup_drafts
      WHERE tenant_id = ${TENANT_A}::uuid AND id = ${results[0].id}::uuid
    `;
    expect(rows[0]?.count).toBe(1);
  });
});
