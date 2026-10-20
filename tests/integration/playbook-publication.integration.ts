import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import postgres, { type Sql } from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { RecordPlaybookPublicationRequest } from '@shared/api.interface';
import { PlaybookPublicationController } from '@server/modules/knowledge/playbook-publication.controller';
import { PlaybookPublicationService } from '@server/modules/knowledge/playbook-publication.service';
import { PLAYBOOK_PUBLICATION_REPOSITORY } from '@server/modules/knowledge/playbook-publication.ports';
import { PostgresPlaybookPublicationRepository } from '@server/modules/knowledge/postgres-playbook-publication.repository';
import { PostgresPlaybookAuthoringRepository } from '@server/modules/knowledge/postgres-playbook-authoring.repository';
import { PostgresPlaybookDraftReviewRepository } from '@server/modules/knowledge/postgres-playbook-draft-review.repository';
import { PlatformShellService } from '@server/modules/platform-shell/platform-shell.service';
import { PlatformAccessDeniedError } from '@server/modules/platform-shell/platform-session.service';
import { FeishuWebAuthService, FeishuWebAuthError } from '@server/modules/web-auth/feishu-web-auth.service';

const databaseUrl: string | undefined = process.env.DATABASE_URL;
describe.skipIf(!databaseUrl)('Playbook publication PostgreSQL and HTTP', (): void => {
  const sql: Sql = postgres(databaseUrl!, { max: 6, onnotice: (): void => undefined });
  const tenantId: string = randomUUID();
  const otherTenant: string = randomUUID();
  const memberId: string = randomUUID();
  const otherMember: string = randomUUID();
  const authoring = new PostgresPlaybookAuthoringRepository(sql);
  const review = new PostgresPlaybookDraftReviewRepository(sql);
  const repository = new PostgresPlaybookPublicationRepository(sql);
  const service = new PlaybookPublicationService(repository);
  let app: INestApplication;
  let baseUrl: string;
  const create = async (approved = true, id: string = randomUUID()): Promise<string> => {
    await sql`INSERT INTO playbook_optimization_candidates (
      tenant_id, id, question_fingerprint, topic_preview, last_qa_status, occurrence_count,
      reasons, source_refs, status, first_observed_at, last_observed_at
    ) VALUES (${tenantId}::uuid, ${id}::uuid, ${randomUUID()}, '发布验收', 'answered', 3,
      '[]'::jsonb, '[{"sourceId":"source-1","sourceVersion":"v1"}]'::jsonb, 'accepted_for_authoring', now(), now())`;
    await save(id, 0);
    if (approved) await approve(id, 1, 0);
    return id;
  };
  const save = async (id: string, expectedVersion: number): Promise<void> => {
    await authoring.save({ tenantId, candidateId: id, authorMemberId: memberId,
      expectedVersion, requestId: randomUUID(), title: `发布版本 ${expectedVersion + 1}`,
      body: `第 ${expectedVersion + 1} 版包含经过确认的接口范围和验收条件。`,
      applicability: '技术评审阶段', changeNote: '独立版本说明' });
  };
  const approve = async (id: string, expectedVersion: number, sequence: number): Promise<void> => {
    for (const action of ['submit', 'approve'] as const) {
      const result = await review.record({ tenantId, candidateId: id, actorMemberId: memberId,
        requestId: randomUUID(), expectedVersion, expectedReviewSequence: sequence++, action, note: '已复核版本' });
      expect(result.status).toBe('recorded');
    }
  };
  const request = (sequence = 0, version = 1, reviewSequence = 2): RecordPlaybookPublicationRequest => ({
    requestId: randomUUID(), expectedPublicationSequence: sequence, expectedVersion: version,
    expectedReviewSequence: reviewSequence, action: 'publish', note: '发布正式内容',
  });
  const record = (id: string, input: RecordPlaybookPublicationRequest = request()) =>
    service.record({ ...input, tenantId, candidateId: id, actorMemberId: memberId });
  const withdraw = (sequence = 1, version = 1): RecordPlaybookPublicationRequest => ({
    requestId: randomUUID(), expectedPublicationSequence: sequence, expectedVersion: version,
    expectedReviewSequence: null, action: 'withdraw', note: '撤回当前内容',
  });
  const http = (path: string, token = 'admin', body?: unknown): Promise<Response> => fetch(`${baseUrl}/api/platform/${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'content-type': 'application/json', ...(token ? { cookie: `sales-agent-session=${token}` } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  beforeAll(async (): Promise<void> => {
    await sql`INSERT INTO agent_tenants (id, feishu_tenant_key, name, status) VALUES
      (${tenantId}::uuid, ${tenantId}, '发布测试 A', 'active'), (${otherTenant}::uuid, ${otherTenant}, '发布测试 B', 'active')`;
    await sql`INSERT INTO tenant_members (tenant_id, id, feishu_open_id, display_name, status) VALUES
      (${tenantId}::uuid, ${memberId}::uuid, ${memberId}, '发布管理员', 'active'),
      (${otherTenant}::uuid, ${otherMember}::uuid, ${otherMember}, '其他租户', 'active')`;
    class PublicationTestModule {}
    app = await NestFactory.create({ module: PublicationTestModule, controllers: [PlaybookPublicationController],
      providers: [PlaybookPublicationService, { provide: PLAYBOOK_PUBLICATION_REPOSITORY, useValue: repository },
        { provide: FeishuWebAuthService, useValue: { authenticateSession: async (token: string) => {
          if (token === 'expired') throw new FeishuWebAuthError('UNAUTHENTICATED', 'expired');
          return { tenantId: token === 'other' ? otherTenant : tenantId,
            member: { id: token === 'other' ? otherMember : memberId }, tokenHash: token };
        } } },
        { provide: PlatformShellService, useValue: { assertPermission: async (
          session: { tokenHash: string }, permission: string,
        ): Promise<void> => {
          if (session.tokenHash === 'denied' || (permission === 'playbook:publish' && session.tokenHash !== 'admin') ||
            (permission === 'playbook:review' && session.tokenHash === 'reader')) throw new PlatformAccessDeniedError();
        } } },
      ],
    }, { logger: false });
    await app.listen(0, '127.0.0.1'); baseUrl = await app.getUrl();
  });
  afterAll(async (): Promise<void> => {
    try { if (app) await app.close(); await sql`DELETE FROM agent_tenants WHERE id IN (${tenantId}::uuid, ${otherTenant}::uuid)`; }
    finally { await sql.end({ timeout: 2 }); }
  });

  it('refuses unpublished and unapproved versions and exposes no draft through public reads', async (): Promise<void> => {
    const id = await create(false);
    await expect(record(id)).rejects.toMatchObject({ code: 'CONFLICT' });
    expect((await http(`playbooks/${id}`, 'reader')).status).toBe(404);
    await review.record({ tenantId, candidateId: id, actorMemberId: memberId, requestId: randomUUID(),
      action: 'submit', expectedVersion: 1, expectedReviewSequence: 0, note: '等待管理员审核' });
    await expect(record(id, request(0, 1, 1))).rejects.toMatchObject({ code: 'CONFLICT' });
    expect((await service.list(tenantId, id)).history).toEqual([]);
  });
  it('serializes concurrent publication and exact retries to one event', async (): Promise<void> => {
    const id = await create(); const input = request();
    const same = await Promise.all([record(id, input), record(id, input)]);
    expect(same[0]).toEqual(same[1]);
    await expect(record(id, request(1))).rejects.toMatchObject({ code: 'CONFLICT' });
    expect((await service.list(tenantId, id)).history).toHaveLength(1);
    const second = await create();
    const different = await Promise.allSettled([record(second), record(second)]);
    expect(different.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
  });
  it('keeps the old publication while a new draft supersedes approval, then replaces only after approval', async (): Promise<void> => {
    const id = await create(); await record(id); await save(id, 1);
    expect((await service.getPublished(tenantId, id)).version).toBe(1);
    expect((await service.list(tenantId, id)).approvedVersion).toBeNull();
    await expect(record(id, request(1, 1, 2))).rejects.toMatchObject({ code: 'CONFLICT' });
    await expect(record(id, request(1, 2, 2))).rejects.toMatchObject({ code: 'CONFLICT' });
    await approve(id, 2, 2); await record(id, request(1, 2, 4));
    const current = await service.getPublished(tenantId, id);
    expect(current.version).toBe(2); expect(current.body).toContain('第 2 版');
    expect(current.sources).toEqual([{ sourceId: 'source-1', sourceVersion: 'v1' }]);
    expect(await authoring.get({ tenantId, candidateId: id, version: 1 })).toMatchObject({ body: expect.stringContaining('第 1 版') });
  });
  it('withdraws despite new draft, review or candidate status, and replay never restores current content', async (): Promise<void> => {
    const id = await create(); const published = request();
    const first = await record(id, published); await save(id, 1);
    await sql`UPDATE playbook_optimization_candidates SET status = 'dismissed' WHERE tenant_id = ${tenantId}::uuid AND id = ${id}::uuid`;
    const removal = withdraw(); const removed = await record(id, removal);
    expect(removed.approvedReviewSequence).toBe(first.approvedReviewSequence);
    expect(await record(id, published)).toEqual(first);
    expect(await record(id, removal)).toEqual(removed);
    expect((await service.list(tenantId, id)).active).toBeNull();
    await expect(service.getPublished(tenantId, id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(record(id, withdraw(2))).rejects.toMatchObject({ code: 'CONFLICT' });
  });
  it('rejects stale publication/review/version expectations and changed idempotency payloads', async (): Promise<void> => {
    const id = await create(); const input = request(); await record(id, input);
    for (const patch of [{ note: '不同说明' }, { expectedVersion: 2 }, { expectedReviewSequence: 1 },
      { expectedPublicationSequence: 1 }, { action: 'withdraw', expectedReviewSequence: null }] as const) {
      await expect(record(id, { ...input, ...patch } as RecordPlaybookPublicationRequest)).rejects.toMatchObject({ code: 'CONFLICT' });
    }
    await expect(service.record({ ...input, tenantId, candidateId: id, actorMemberId: otherMember }))
      .rejects.toMatchObject({ code: 'CONFLICT' });
    await expect(record(id, withdraw(0))).rejects.toMatchObject({ code: 'CONFLICT' });
    await expect(record(id, withdraw(1, 2))).rejects.toMatchObject({ code: 'CONFLICT' });
  });
  it('serializes draft saves with publication and withdrawal without losing current content', async (): Promise<void> => {
    const id = await create();
    const outcomes = await Promise.allSettled([record(id), save(id, 1)]);
    expect(outcomes[1].status).toBe('fulfilled');
    const state = await service.list(tenantId, id);
    expect(state.latestDraft?.version).toBe(2); expect(state.approvedVersion).toBeNull();
    expect(state.active?.version ?? null).toBe(outcomes[0].status === 'fulfilled' ? 1 : null);
    if (state.active) { await record(id, withdraw()); expect((await service.list(tenantId, id)).active).toBeNull(); }
  });
  it('pages immutable audit history exclusively and allows deliberate republishing', async (): Promise<void> => {
    const id = await create();
    for (let index = 0; index < 24; index += 1) await record(id, index % 2 ? withdraw(index) : request(index));
    const page = await service.list(tenantId, id);
    expect(page.history).toHaveLength(20); expect(page.nextBeforeSequence).toBe(5);
    const rest = await service.list(tenantId, id, '5');
    expect(rest.history.map((item) => item.sequence)).toEqual([4, 3, 2, 1]);
    expect(rest.current?.sequence).toBe(24); expect(rest.active).toBeNull();
  });
  it('persists across connections and prevents cross-tenant members or fabricated review references', async (): Promise<void> => {
    const id = await create();
    await expect(service.record({ ...request(), tenantId, candidateId: id, actorMemberId: otherMember }))
      .rejects.toMatchObject({ code: 'UNAVAILABLE' });
    expect((await service.list(tenantId, id)).history).toEqual([]); await record(id);
    const fresh: Sql = postgres(databaseUrl!, { max: 1 });
    try { expect(await new PostgresPlaybookPublicationRepository(fresh).getPublished(tenantId, id)).toMatchObject({ version: 1 }); }
    finally { await fresh.end({ timeout: 1 }); }
    await expect(sql`INSERT INTO playbook_publication_events (
      tenant_id, candidate_id, sequence, draft_version, approved_review_sequence,
      expected_publication_sequence, expected_review_sequence, request_id, actor_member_id, action, note
    ) VALUES (${tenantId}::uuid, ${id}::uuid, 2, 2, 2, 1, 2, ${randomUUID()}::uuid, ${memberId}::uuid, 'publish', '错误版本引用')`)
      .rejects.toMatchObject({ code: '23503' });
  });
  it('provides sales only current public content, whitelists identity, and isolates tenants', async (): Promise<void> => {
    const id = await create();
    const posted = await http(`playbook-candidates/${id}/publication`, 'admin', {
      ...request(), tenantId: otherTenant, actorMemberId: otherMember, body: '伪造正文',
    });
    expect(posted.status).toBe(201); expect((await posted.json()).actorMemberId).toBe(memberId);
    const published = await http(`playbooks/${id}`, 'reader');
    expect(published.status).toBe(200); expect(published.headers.get('cache-control')).toBe('no-store');
    const content = await published.json();
    expect(Object.keys(content).sort()).toEqual(['applicability', 'body', 'candidateId', 'publicationSequence', 'publishedAt', 'sources', 'title', 'version']);
    expect((await http(`playbook-candidates/${id}/publication`, 'reader')).status).toBe(403);
    expect((await http(`playbook-candidates/${id}/publication`, 'reader', request())).status).toBe(403);
    expect((await http(`playbooks/${id}`, 'other')).status).toBe(404);
    expect((await http(`playbook-candidates/${id}/publication`, 'other')).status).toBe(404);
    expect((await http('playbooks', 'other')).status).toBe(200);
    expect((await (await http('playbooks', 'other')).json()).items).toEqual([]);
  });
  it.each(['', 'expired', 'denied'])('protects all routes and disables caching for %s', async (token): Promise<void> => {
    const id = randomUUID();
    for (const [path, body] of [['playbooks', undefined], [`playbooks/${id}`, undefined],
      [`playbook-candidates/${id}/publication`, undefined], [`playbook-candidates/${id}/publication`, request()]] as const) {
      const response = await http(path, token, body);
      expect(response.status).toBe(token === 'denied' ? 403 : 401);
      expect(response.headers.get('cache-control')).toBe('no-store');
    }
  });
  it('rejects malformed HTTP inputs without creating audit records', async (): Promise<void> => {
    const id = await create();
    for (const body of [null, [], {}, { ...request(), expectedVersion: 0 }, { ...withdraw(), expectedReviewSequence: 2 }]) {
      expect((await http(`playbook-candidates/${id}/publication`, 'admin', body)).status).toBe(body === null ? 400 : 422);
    }
    expect((await http('playbooks?afterCandidateId=invalid')).status).toBe(422);
    expect((await http(`playbook-candidates/${id}/publication?beforeSequence=0`)).status).toBe(422);
    expect((await service.list(tenantId, id)).history).toEqual([]);
  });
  it('pages only active catalog entries without bodies, duplicates or withdrawn versions', async (): Promise<void> => {
    const ids: string[] = [];
    for (let index = 0; index < 21; index += 1) { const id = await create(); ids.push(id); await record(id); }
    await record(ids[0], withdraw());
    const seen: string[] = [];
    let cursor: string | undefined;
    do {
      const page = await service.listPublished(tenantId, cursor);
      expect(page.items.every((item) => !('body' in item) && !('note' in item))).toBe(true);
      seen.push(...page.items.map((item) => item.candidateId));
      cursor = page.nextAfterCandidateId ?? undefined;
    } while (cursor);
    expect(new Set(seen).size).toBe(seen.length); expect(seen).not.toContain(ids[0]);
    expect(ids.slice(1).every((id) => seen.includes(id))).toBe(true);
  });
  it('includes the largest sequence in history and an all-zero candidate in the first catalog page', async (): Promise<void> => {
    const id = '00000000-0000-0000-0000-000000000000';
    await create(true, id);
    await record(id);
    expect((await service.listPublished(tenantId)).items[0].candidateId).toBe(id);
    await sql`INSERT INTO playbook_publication_events (
      tenant_id, candidate_id, sequence, draft_version, approved_review_sequence,
      expected_publication_sequence, expected_review_sequence, request_id, actor_member_id, action, note
    ) VALUES (${tenantId}::uuid, ${id}::uuid, 2147483647, 1, 2, 2147483646, NULL,
      ${randomUUID()}::uuid, ${memberId}::uuid, 'withdraw', '最大序号边界')`;
    const page = await service.list(tenantId, id);
    expect(page.history.map((item) => item.sequence)).toEqual([2147483647, 1]);
    expect(page.current?.sequence).toBe(2147483647); expect(page.active).toBeNull();
  });
});
