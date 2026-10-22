import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import postgres, { type JSONValue, type Sql } from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { RecordPlaybookAdoptionRequest } from '@shared/api.interface';
import { PlaybookAdoptionController } from '@server/modules/knowledge/playbook-adoption.controller';
import { PLAYBOOK_ADOPTION_REPOSITORY } from '@server/modules/knowledge/playbook-adoption.ports';
import { PlaybookAdoptionService } from '@server/modules/knowledge/playbook-adoption.service';
import { PostgresPlaybookAdoptionRepository } from '@server/modules/knowledge/postgres-playbook-adoption.repository';
import { PlatformAccessDeniedError } from '@server/modules/platform-shell/platform-session.service';
import { PlatformShellService } from '@server/modules/platform-shell/platform-shell.service';
import { FeishuWebAuthError, FeishuWebAuthService } from '@server/modules/web-auth/feishu-web-auth.service';

const databaseUrl: string | undefined = process.env.DATABASE_URL;
describe.skipIf(!databaseUrl)('Playbook adoption PostgreSQL and HTTP', (): void => {
  const sql: Sql = postgres(databaseUrl!, { max: 8, onnotice: (): void => undefined });
  const tenantId: string = randomUUID(); const otherTenant: string = randomUUID();
  const memberId: string = randomUUID(); const otherMember: string = randomUUID();
  const memberOpenId: string = 'ou-adoption-owner'; const otherOpenId: string = 'ou-other-owner';
  const repository = new PostgresPlaybookAdoptionRepository(sql);
  const service = new PlaybookAdoptionService(repository);
  let app: INestApplication; let baseUrl: string; let candidateId: string; let actionId: string;

  const createCandidate = async (): Promise<string> => {
    const id: string = randomUUID();
    await sql`INSERT INTO playbook_optimization_candidates (
      tenant_id, id, question_fingerprint, topic_preview, last_qa_status, occurrence_count,
      reasons, source_refs, status, first_observed_at, last_observed_at
    ) VALUES (${tenantId}::uuid, ${id}::uuid, ${randomUUID()}, '采用测试', 'answered', 1,
      '[]'::jsonb, '[]'::jsonb, 'accepted_for_authoring', now(), now())`;
    await sql`INSERT INTO playbook_draft_versions (
      tenant_id, candidate_id, version, expected_version, request_id, author_member_id,
      title, body, applicability, change_note, source_refs
    ) VALUES (${tenantId}::uuid, ${id}::uuid, 1, 0, ${randomUUID()}::uuid, ${memberId}::uuid,
      '采用测试版本', '这是足够长的已批准 Playbook 正文，用于集成验证。', '销售评审阶段', '初版', '[]'::jsonb)`;
    await sql`INSERT INTO playbook_draft_review_events (
      tenant_id, candidate_id, sequence, draft_version, expected_version,
      expected_review_sequence, request_id, actor_member_id, action, note
    ) VALUES (${tenantId}::uuid, ${id}::uuid, 1, 1, 1, 0, ${randomUUID()}::uuid,
      ${memberId}::uuid, 'submit', '已提交审核'), (${tenantId}::uuid, ${id}::uuid, 2, 1, 1, 1,
      ${randomUUID()}::uuid, ${memberId}::uuid, 'approve', '已批准版本')`;
    await sql`INSERT INTO playbook_publication_events (
      tenant_id, candidate_id, sequence, draft_version, approved_review_sequence,
      expected_publication_sequence, expected_review_sequence, request_id, actor_member_id, action, note
    ) VALUES (${tenantId}::uuid, ${id}::uuid, 1, 1, 2, 0, 2, ${randomUUID()}::uuid,
      ${memberId}::uuid, 'publish', '已发布采用测试版本')`;
    return id;
  };
  const createAction = async (patch: { actorOpenId?: string; status?: string; result?: JSONValue } = {}): Promise<string> => {
    const id: string = randomUUID();
    await sql`INSERT INTO pending_actions (tenant_id, id, actor_open_id, chat_id, status, payload, result, expires_at)
      VALUES (${tenantId}::uuid, ${id}::uuid, ${patch.actorOpenId ?? memberOpenId}, 'adoption-chat',
        ${patch.status ?? 'succeeded'}, ${sql.json({ actionKind: 'followup' })}, ${sql.json(patch.result ?? { followupRecordId: 'rec-followup' })}, now() + interval '1 day')`;
    return id;
  };
  const input = (requestId: string = randomUUID(), expectedAdoptionSequence = 0): RecordPlaybookAdoptionRequest => ({
    requestId, expectedAdoptionSequence, publicationVersion: 1, publicationSequence: 1, action: 'record',
    evidence: { kind: 'followup', recordId: 'rec-followup', actionId, note: '真实跟进已写入' }, note: '已在客户沟通后采用',
  });
  const http = (path: string, token = 'owner', body?: unknown): Promise<Response> => fetch(`${baseUrl}/api/platform/${path}`, {
    method: body === undefined ? 'GET' : 'POST', headers: { 'content-type': 'application/json', ...(token ? { cookie: `sales-agent-session=${token}` } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

  beforeAll(async (): Promise<void> => {
    await sql`INSERT INTO agent_tenants (id, feishu_tenant_key, name, status) VALUES
      (${tenantId}::uuid, ${tenantId}, '采用测试 A', 'active'), (${otherTenant}::uuid, ${otherTenant}, '采用测试 B', 'active')`;
    await sql`INSERT INTO tenant_members (tenant_id, id, feishu_open_id, display_name, status) VALUES
      (${tenantId}::uuid, ${memberId}::uuid, ${memberOpenId}, '采用本人', 'active'),
      (${otherTenant}::uuid, ${otherMember}::uuid, ${otherOpenId}, '另一租户', 'active')`;
    candidateId = await createCandidate(); actionId = await createAction();
    class AdoptionTestModule {}
    app = await NestFactory.create({ module: AdoptionTestModule, controllers: [PlaybookAdoptionController], providers: [
      PlaybookAdoptionService, { provide: PLAYBOOK_ADOPTION_REPOSITORY, useValue: repository },
      { provide: FeishuWebAuthService, useValue: { authenticateSession: async (token: string) => {
        if (token === 'expired') throw new FeishuWebAuthError('UNAUTHENTICATED', 'expired');
        const other: boolean = token === 'other';
        return { tenantId: other ? otherTenant : tenantId, tokenHash: token,
          member: { id: other ? otherMember : memberId, feishuOpenId: other ? otherOpenId : memberOpenId } };
      } } },
      { provide: PlatformShellService, useValue: { assertPermission: async (session: { tokenHash: string }, permission: string): Promise<void> => {
        if (session.tokenHash === 'denied' || (permission === 'playbook:adopt' && session.tokenHash === 'reader')) throw new PlatformAccessDeniedError();
      } } },
    ] }, { logger: false });
    await app.listen(0, '127.0.0.1'); baseUrl = await app.getUrl();
  });
  afterAll(async (): Promise<void> => {
    try {
      if (app) await app.close();
      await sql`DELETE FROM playbook_adoption_events
        WHERE tenant_id IN (${tenantId}::uuid, ${otherTenant}::uuid)`;
      await sql`DELETE FROM agent_tenants
        WHERE id IN (${tenantId}::uuid, ${otherTenant}::uuid)`;
    }
    finally { await sql.end({ timeout: 2 }); }
  });

  it('records real action evidence, replays exact requests and rejects changed payloads', async (): Promise<void> => {
    const request: RecordPlaybookAdoptionRequest = input(); const first = await service.record({ ...request, tenantId, candidateId, actorMemberId: memberId, actorOpenId: memberOpenId });
    expect(first).toMatchObject({ sequence: 1, action: 'record', publicationVersion: 1 });
    expect(await service.record({ ...request, tenantId, candidateId, actorMemberId: memberId, actorOpenId: memberOpenId })).toEqual(first);
    await expect(service.record({ ...request, note: '改变同一请求参数', tenantId, candidateId, actorMemberId: memberId, actorOpenId: memberOpenId })).rejects.toMatchObject({ code: 'CONFLICT' });
    expect((await service.list(tenantId, candidateId)).status).toBe('adopted');
  });

  it('uses CAS for retraction and rejects stale publication or fabricated evidence', async (): Promise<void> => {
    const retract: RecordPlaybookAdoptionRequest = { ...input(randomUUID(), 1), action: 'retract', evidence: null, note: '采用结果已撤回' };
    const event = await service.record({ ...retract, tenantId, candidateId, actorMemberId: memberId, actorOpenId: memberOpenId });
    expect(event.action).toBe('retract');
    await expect(service.record({ ...input(randomUUID(), 0), tenantId, candidateId, actorMemberId: memberId, actorOpenId: memberOpenId })).rejects.toMatchObject({ code: 'CONFLICT' });
    const foreignAction: string = await createAction({ actorOpenId: otherOpenId });
    const otherCandidate: string = await createCandidate();
    await expect(service.record({ ...input(randomUUID(), 0), candidateId: otherCandidate, evidence: { ...input().evidence!, actionId: foreignAction }, tenantId, actorMemberId: memberId, actorOpenId: memberOpenId })).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('serializes concurrent CAS writes and keeps tenant and HTTP boundaries', async (): Promise<void> => {
    const concurrentCandidate: string = await createCandidate(); const concurrentAction: string = await createAction();
    const request: RecordPlaybookAdoptionRequest = { ...input(randomUUID(), 0), evidence: { ...input().evidence!, actionId: concurrentAction } };
    const results = await Promise.allSettled([service.record({ ...request, tenantId, candidateId: concurrentCandidate, actorMemberId: memberId, actorOpenId: memberOpenId }), service.record({ ...request, requestId: randomUUID(), tenantId, candidateId: concurrentCandidate, actorMemberId: memberId, actorOpenId: memberOpenId })]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect((await http(`playbook-candidates/${candidateId}/adoption`)).status).toBe(200);
    expect((await http(`playbook-candidates/${candidateId}/adoption`, '')).status).toBe(401);
    expect((await http(`playbook-candidates/${candidateId}/adoption`, 'reader', input())).status).toBe(403);
    expect((await http(`playbook-candidates/${candidateId}/adoption`, 'other')).status).toBe(404);
    const posted = await http(`playbook-candidates/${candidateId}/adoption`, 'owner', { ...input(randomUUID(), 0), tenantId: otherTenant, actorMemberId: otherMember, actorOpenId: otherOpenId });
    expect(posted.status).toBe(409); expect(posted.headers.get('cache-control')).toBe('no-store');
  });
});
