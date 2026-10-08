import { config as loadEnvironment } from 'dotenv';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Sql } from 'postgres';

import type {
  PlaybookOptimizationCandidate,
  SalesKnowledgeQaResponse,
} from '@shared/api.interface';
import type { TenantIntegration } from
  '@server/modules/agent-core/agent.types';
import { PlaybookOptimizationService } from
  '@server/modules/knowledge/playbook-optimization.service';
import { PostgresPlaybookOptimizationRepository } from
  '@server/modules/knowledge/postgres-playbook-optimization.repository';

loadEnvironment({ path: ['.env.local', '.env'], quiet: true });

const TENANT_A = '71000000-0000-4000-8000-000000000001';
const TENANT_B = '71000000-0000-4000-8000-000000000002';
const MEMBER_A = '72000000-0000-4000-8000-000000000001';
const MEMBER_B = '72000000-0000-4000-8000-000000000002';
const BASE_TIME = new Date('2026-10-08T04:00:00.000Z');
const databaseUrl: string | undefined = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error('DATABASE_URL is required for playbook integration tests');
}

const sql: Sql = postgres(databaseUrl, {
  max: 3,
  connect_timeout: 10,
  idle_timeout: 5,
  onnotice: (): void => undefined,
});

const integration = (tenantId: string): TenantIntegration => ({
  tenantId,
  feishuTenantKey: `playbook-${tenantId}`,
  name: '知识优化测试企业',
  status: 'active',
  appId: 'app',
  appSecretEnv: 'TEST_SECRET',
  appType: 'selfBuild',
  base: {
    appToken: 'base',
    customers: {
      tableId: 'customers',
      primaryField: '客户',
      fields: { customerName: '客户' },
    },
    opportunities: {
      tableId: 'opportunities',
      primaryField: '商机',
      fields: { opportunityName: '商机', customerLink: '客户关联' },
    },
    followups: {
      tableId: 'followups',
      primaryField: '跟进',
      fields: {
        sourceMessageId: '消息',
        customerLink: '客户关联',
        opportunityLink: '商机关联',
        rawText: '原文',
        summary: '摘要',
      },
    },
    knowledge: {
      sources: [{
        id: 'capabilities',
        sourceType: 'docx',
        token: 'private-token',
        url: 'https://example.feishu.cn/docx/private-token',
        applicability: '内部使用',
        keywords: ['产品能力'],
        categories: ['solution_overview'],
      }],
    },
  },
});

const qaResult = (
  status: SalesKnowledgeQaResponse['status'],
  revision: string = 'revision:1',
): SalesKnowledgeQaResponse => ({
  status,
  answer: status === 'answered' ? '绝不能保存的答案正文' : '没有可信答案',
  configuredSourceCount: 1,
  checkedSourceCount: 1,
  trustedResultCount: status === 'answered' ? 1 : 0,
  citations: status === 'answered' ? [{
    sourceId: 'capabilities',
    sourceType: 'docx',
    title: '内部资料',
    url: 'https://example.feishu.cn/docx/private-token',
    matchedTerms: ['产品能力'],
    excerpt: '绝不能保存的资料正文摘录',
    citation: '正文第 1 段',
    sourceVersion: revision,
    applicability: '内部使用',
    accessVerified: true,
  }] : [],
  warnings: [],
});

describe('Postgres playbook optimization repository', (): void => {
  const repository = new PostgresPlaybookOptimizationRepository(sql);
  const service = new PlaybookOptimizationService(repository);

  beforeAll(async (): Promise<void> => {
    await sql`DELETE FROM agent_tenants WHERE id IN (${TENANT_A}::uuid, ${TENANT_B}::uuid)`;
    await sql`
      INSERT INTO agent_tenants (id, feishu_tenant_key, name, status)
      VALUES
        (${TENANT_A}::uuid, 'playbook-optimization-a', '知识优化 A', 'active'),
        (${TENANT_B}::uuid, 'playbook-optimization-b', '知识优化 B', 'active')
    `;
    await sql`
      INSERT INTO tenant_members (
        tenant_id, id, feishu_open_id, display_name, status
      ) VALUES
        (${TENANT_A}::uuid, ${MEMBER_A}::uuid, 'ou_manager_a', '经理 A', 'active'),
        (${TENANT_B}::uuid, ${MEMBER_B}::uuid, 'ou_manager_b', '经理 B', 'active')
    `;
  });

  afterAll(async (): Promise<void> => {
    await sql`DELETE FROM agent_tenants WHERE id IN (${TENANT_A}::uuid, ${TENANT_B}::uuid)`;
    await sql.end({ timeout: 5 });
  });

  it('deduplicates, promotes frequent questions and isolates tenants', async (): Promise<void> => {
    const question = '某客户联系人 13800138000 反复问产品能力是什么？';
    for (let index = 0; index < 3; index += 1) {
      await service.observe({
        integration: integration(TENANT_A),
        question,
        result: qaResult('answered'),
        observedAt: new Date(BASE_TIME.getTime() + index * 1_000),
      });
    }
    await service.observe({
      integration: integration(TENANT_B),
      question,
      result: qaResult('no_trusted_match'),
      observedAt: BASE_TIME,
    });

    const listA = await service.list(TENANT_A);
    const listB = await service.list(TENANT_B);
    expect(listA.items).toHaveLength(1);
    expect(listA.items[0]).toMatchObject({
      occurrenceCount: 3,
      status: 'pending_review',
      reasons: ['frequent_question'],
      topicPreview: '产品能力与解决方案',
    });
    expect(listB.items).toHaveLength(1);
    expect(listB.items[0]).toMatchObject({
      occurrenceCount: 1,
      reasons: ['no_trusted_answer'],
    });

    const stored = await sql<{ payload: string }[]>`
      SELECT row_to_json(candidate)::text AS payload
      FROM playbook_optimization_candidates AS candidate
      WHERE tenant_id = ${TENANT_A}::uuid
    `;
    const payload = stored[0]?.payload ?? '';
    expect(payload).not.toContain(question);
    expect(payload).not.toContain('13800138000');
    expect(payload).not.toContain('绝不能保存的答案正文');
    expect(payload).not.toContain('绝不能保存的资料正文摘录');
    expect(payload).not.toContain('private-token');
  });

  it('detects source revision changes and reviews with immutable audit', async (): Promise<void> => {
    const question = '接口对接有哪些技术条件？';
    await service.observe({
      integration: integration(TENANT_A),
      question,
      result: qaResult('answered', 'revision:1'),
      observedAt: new Date(BASE_TIME.getTime() + 10_000),
    });
    const changed = await service.observe({
      integration: integration(TENANT_A),
      question,
      result: qaResult('answered', 'revision:2'),
      observedAt: new Date(BASE_TIME.getTime() + 11_000),
    });

    expect(changed).toMatchObject({
      status: 'pending_review',
      reasons: ['source_revision_changed'],
      sources: [{ sourceId: 'capabilities', sourceVersion: 'revision:2' }],
    });
    if (changed === null) throw new Error('Expected candidate');
    const reviewedAt = new Date(BASE_TIME.getTime() + 12_000);
    const reviewed = await service.review({
      tenantId: TENANT_A,
      candidateId: changed.id,
      reviewerMemberId: MEMBER_A,
      decision: 'accept_for_authoring',
      expectedUpdatedAt: changed.updatedAt,
      note: '来源版本已变化，进入资料复核与编写',
      now: reviewedAt,
    });
    expect(reviewed.candidate.status).toBe('accepted_for_authoring');

    const audits = await sql<Array<{
      decision: string;
      previous_status: string;
      resulting_status: string;
      note: string;
    }>>`
      SELECT decision, previous_status, resulting_status, note
      FROM playbook_optimization_reviews
      WHERE tenant_id = ${TENANT_A}::uuid
        AND candidate_id = ${changed.id}::uuid
    `;
    expect(audits).toEqual([{
      decision: 'accept_for_authoring',
      previous_status: 'pending_review',
      resulting_status: 'accepted_for_authoring',
      note: '来源版本已变化，进入资料复核与编写',
    }]);

    await expect(service.review({
      tenantId: TENANT_A,
      candidateId: changed.id,
      reviewerMemberId: MEMBER_A,
      decision: 'dismiss',
      expectedUpdatedAt: changed.updatedAt,
      note: '尝试用旧版本覆盖',
      now: new Date(BASE_TIME.getTime() + 13_000),
    })).rejects.toMatchObject({ code: 'CONFLICT' });
    const auditCount = await sql<Array<{ count: number }>>`
      SELECT count(*)::int AS count
      FROM playbook_optimization_reviews
      WHERE tenant_id = ${TENANT_A}::uuid
        AND candidate_id = ${changed.id}::uuid
    `;
    expect(auditCount[0]?.count).toBe(1);
  });

  it('cannot review another tenant candidate', async (): Promise<void> => {
    const target: PlaybookOptimizationCandidate | undefined =
      (await service.list(TENANT_B)).items[0];
    if (target === undefined) throw new Error('Expected tenant B candidate');
    await expect(service.review({
      tenantId: TENANT_A,
      candidateId: target.id,
      reviewerMemberId: MEMBER_A,
      decision: 'dismiss',
      expectedUpdatedAt: target.updatedAt,
      note: '跨租户审核必须失败',
      now: new Date(BASE_TIME.getTime() + 20_000),
    })).rejects.toMatchObject({ code: 'NOT_FOUND' });

    const dismissed = await service.review({
      tenantId: TENANT_B,
      candidateId: target.id,
      reviewerMemberId: MEMBER_B,
      decision: 'dismiss',
      expectedUpdatedAt: target.updatedAt,
      note: '该问题暂不进入资料编写',
      now: new Date(BASE_TIME.getTime() + 21_000),
    });
    expect(dismissed.candidate.status).toBe('dismissed');
    const audits = await sql<Array<{ decision: string }>>`
      SELECT decision
      FROM playbook_optimization_reviews
      WHERE tenant_id = ${TENANT_B}::uuid
        AND candidate_id = ${target.id}::uuid
    `;
    expect(audits).toEqual([{ decision: 'dismiss' }]);
  });
});
