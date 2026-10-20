import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import postgres, { type Sql } from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { RecordPlaybookDraftReviewRequest, SavePlaybookDraftRequest } from '@shared/api.interface';
import { PlaybookAuthoringController } from '@server/modules/knowledge/playbook-authoring.controller';
import { PlaybookAuthoringService } from '@server/modules/knowledge/playbook-authoring.service';
import { PlaybookDraftReviewController } from '@server/modules/knowledge/playbook-draft-review.controller';
import { PlaybookDraftReviewService } from '@server/modules/knowledge/playbook-draft-review.service';
import { PlaybookPublicationController } from '@server/modules/knowledge/playbook-publication.controller';
import { PlaybookPublicationService } from '@server/modules/knowledge/playbook-publication.service';
import { PLAYBOOK_PUBLICATION_REPOSITORY } from '@server/modules/knowledge/playbook-publication.ports';
import { PostgresPlaybookPublicationRepository } from '@server/modules/knowledge/postgres-playbook-publication.repository';
import { PLAYBOOK_AUTHORING_REPOSITORY, PLAYBOOK_DRAFT_REVIEW_REPOSITORY } from '@server/modules/knowledge/playbook-authoring.ports';
import { PostgresPlaybookAuthoringRepository } from '@server/modules/knowledge/postgres-playbook-authoring.repository';
import { PostgresPlaybookDraftReviewRepository } from '@server/modules/knowledge/postgres-playbook-draft-review.repository';
import { PlatformShellService } from '@server/modules/platform-shell/platform-shell.service';
import { PlatformAccessDeniedError } from '@server/modules/platform-shell/platform-session.service';
import { FeishuWebAuthService, FeishuWebAuthError } from '@server/modules/web-auth/feishu-web-auth.service';

const databaseUrl: string | undefined = process.env.DATABASE_URL;

describe.skipIf(!databaseUrl)('Playbook drafts with PostgreSQL and HTTP', (): void => {
  const sql: Sql = postgres(databaseUrl!, { max: 6, onnotice: (): void => undefined });
  const tenantId: string = randomUUID();
  const otherTenant: string = randomUUID();
  const memberId: string = randomUUID();
  const otherMember: string = randomUUID();
  const secondAuthor: string = randomUUID();
  const adminMember: string = randomUUID();
  const repository = new PostgresPlaybookAuthoringRepository(sql);
  const reviewRepository = new PostgresPlaybookDraftReviewRepository(sql);
  const service = new PlaybookAuthoringService(repository);
  const reviewService = new PlaybookDraftReviewService(reviewRepository);
  let candidateId: string;
  let pendingId: string;
  let reviewCandidateId: string;
  let app: INestApplication;
  let baseUrl: string;
  const draft = (expectedVersion = 0): SavePlaybookDraftRequest => ({
    expectedVersion, requestId: randomUUID(), title: '技术评审指南',
    body: '核对双方接口条件、实施责任及验收标准。',
    applicability: '技术评审阶段', changeNote: `保存第 ${expectedVersion + 1} 版`,
  });
  const createCandidate = async (status = 'accepted_for_authoring'): Promise<string> => {
    const id: string = randomUUID();
    await sql`
      INSERT INTO playbook_optimization_candidates (
        tenant_id, id, question_fingerprint, topic_preview, last_qa_status, occurrence_count,
        reasons, source_refs, status, first_observed_at, last_observed_at
      ) VALUES (${tenantId}::uuid, ${id}::uuid, ${randomUUID()}, '技术评审', 'answered', 3,
        '[]'::jsonb, '[{"sourceId":"source-1","sourceVersion":"v1"}]'::jsonb,
        ${status}, now(), now())
    `;
    return id;
  };
  const save = (input: SavePlaybookDraftRequest, id: string = candidateId) =>
    service.save({ ...input, tenantId, candidateId: id, authorMemberId: memberId });
  const http = (suffix: string, token = 'a', body?: unknown): Promise<Response> => fetch(
    `${baseUrl}/api/platform/playbook-candidates/${candidateId}/draft${suffix}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { 'content-type': 'application/json', ...(token ? { cookie: `sales-agent-session=${token}` } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    },
  );
  const reviewHttp = (id: string, token = 'a', body?: unknown, beforeSequence?: number): Promise<Response> => fetch(
    `${baseUrl}/api/platform/playbook-candidates/${id}/draft/review${beforeSequence === undefined ? '' : `?beforeSequence=${beforeSequence}`}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { 'content-type': 'application/json', ...(token ? { cookie: `sales-agent-session=${token}` } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    },
  );
  const saveReviewDraft = async (expectedVersion: number): Promise<void> => {
    const input: SavePlaybookDraftRequest = draft(expectedVersion);
    await service.save({ ...input, tenantId, candidateId: reviewCandidateId, authorMemberId: memberId });
  };
  const reviewRequest = (expectedVersion: number, expectedReviewSequence: number,
    action: RecordPlaybookDraftReviewRequest['action'], note: string): RecordPlaybookDraftReviewRequest => ({
    requestId: randomUUID(), expectedVersion, expectedReviewSequence, action, note,
  });

  beforeAll(async (): Promise<void> => {
    await sql`INSERT INTO agent_tenants (id, feishu_tenant_key, name, status) VALUES
      (${tenantId}::uuid, ${tenantId}, '草稿测试 A', 'active'),
      (${otherTenant}::uuid, ${otherTenant}, '草稿测试 B', 'active')`;
    await sql`INSERT INTO tenant_members (tenant_id, id, feishu_open_id, display_name, status) VALUES
      (${tenantId}::uuid, ${memberId}::uuid, ${memberId}, '作者 A', 'active'),
      (${tenantId}::uuid, ${secondAuthor}::uuid, ${secondAuthor}, '作者 B', 'active'),
      (${tenantId}::uuid, ${adminMember}::uuid, ${adminMember}, '审核管理员', 'active'),
      (${otherTenant}::uuid, ${otherMember}::uuid, ${otherMember}, '另一租户', 'active')`;
    candidateId = await createCandidate(); pendingId = await createCandidate('pending_review');
    reviewCandidateId = await createCandidate();
    await saveReviewDraft(0);
    class AuthoringTestModule {}
    app = await NestFactory.create({
      module: AuthoringTestModule, controllers: [PlaybookAuthoringController, PlaybookDraftReviewController,
        PlaybookPublicationController],
      providers: [PlaybookAuthoringService,
        PlaybookPublicationService,
        { provide: PLAYBOOK_PUBLICATION_REPOSITORY, useValue: new PostgresPlaybookPublicationRepository(sql) },
        { provide: PLAYBOOK_AUTHORING_REPOSITORY, useValue: repository },
        PlaybookDraftReviewService,
        { provide: PLAYBOOK_DRAFT_REVIEW_REPOSITORY, useValue: reviewRepository },
        { provide: FeishuWebAuthService, useValue: {
          authenticateSession: async (token: string) => {
            if (token === 'expired') throw new FeishuWebAuthError('UNAUTHENTICATED', 'expired');
            return { tenantId: token === 'b' ? otherTenant : tenantId,
              member: { id: token === 'b' ? otherMember : token === 'admin' ? adminMember : memberId }, tokenHash: token };
          },
        } },
        { provide: PlatformShellService, useValue: {
          assertPermission: async (session: { tokenHash: string }, _permission: string): Promise<void> => {
            if (session.tokenHash === 'denied' ||
              (_permission === 'playbook:publish' && session.tokenHash !== 'admin')) {
              throw new PlatformAccessDeniedError();
            }
          },
        } },
      ],
    }, { logger: false });
    await app.listen(0, '127.0.0.1'); baseUrl = await app.getUrl();
  });
  afterAll(async (): Promise<void> => {
    try {
      if (app) await app.close();
      await sql`DELETE FROM agent_tenants WHERE id IN (${tenantId}::uuid, ${otherTenant}::uuid)`;
    } finally { await sql.end({ timeout: 2 }); }
  });

  it('returns an empty draft, but not a cross-tenant candidate', async (): Promise<void> => {
    expect(await service.list(tenantId, candidateId)).toEqual({ latest: null, history: [], nextBeforeVersion: null });
    await expect(service.list(otherTenant, candidateId)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('publishes an approved exact version and exposes only active published content', async (): Promise<void> => {
    const id: string = await createCandidate();
    await save(draft(), id);
    await reviewHttp(id, 'a', reviewRequest(1, 0, 'submit', '检查完成'));
    await reviewHttp(id, 'admin', reviewRequest(1, 1, 'approve', '批准发布内容'));
    const response: Response = await fetch(`${baseUrl}/api/platform/playbook-candidates/${id}/publication`, {
      method: 'POST', headers: { 'content-type': 'application/json', cookie: 'sales-agent-session=admin' },
      body: JSON.stringify({ requestId: randomUUID(), expectedVersion: 1, expectedReviewSequence: 2,
        expectedPublicationSequence: 0, action: 'publish', note: '发布正式版本' }),
    });
    expect(response.status).toBe(201);
    const published: Response = await fetch(`${baseUrl}/api/platform/playbooks/${id}`, {
      headers: { cookie: 'sales-agent-session=a' },
    });
    expect(published.status).toBe(200);
    expect(await published.json()).toMatchObject({ candidateId: id, version: 1, body: draft().body });
  });

  it('serializes competing first versions and produces exactly one version', async (): Promise<void> => {
    const result = await Promise.allSettled([save(draft()), save(draft())]);
    expect(result.filter((item) => item.status === 'fulfilled')).toHaveLength(1);
    expect(result.filter((item) => item.status === 'rejected')).toHaveLength(1);
    expect((await service.list(tenantId, candidateId)).history).toHaveLength(1);
  });

  it('serializes later competing edits and leaves prior content intact', async (): Promise<void> => {
    const result = await Promise.allSettled([save(draft(1)), save({ ...draft(1), body: '另一审核人的完整编辑内容文本。' })]);
    expect(result.filter((item) => item.status === 'fulfilled')).toHaveLength(1);
    expect((await service.list(tenantId, candidateId)).latest?.version).toBe(2);
    expect((await service.get(tenantId, candidateId, '1')).version).toBe(1);
  });

  it('replays one request, including concurrent and delayed response recovery', async (): Promise<void> => {
    const input = draft(2);
    const results = await Promise.all([save(input), save(input)]);
    expect(results[0]).toEqual(results[1]);
    await save(draft(3));
    expect(await save(input)).toEqual(results[0]);
    expect((await service.list(tenantId, candidateId)).latest?.version).toBe(4);
    await expect(save({ ...input, body: '同一个请求编号但更改了草稿正文。' }))
      .rejects.toMatchObject({ code: 'CONFLICT' });
    await expect(service.save({ ...input, tenantId, candidateId, authorMemberId: secondAuthor }))
      .rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('freezes server-side sources per version and never changes older versions', async (): Promise<void> => {
    await sql`UPDATE playbook_optimization_candidates
      SET source_refs = '[{"sourceId":"source-1","sourceVersion":"v2"}]'::jsonb
      WHERE tenant_id = ${tenantId}::uuid AND id = ${candidateId}::uuid`;
    const result = await save(draft(4));
    expect(result.sources).toEqual([{ sourceId: 'source-1', sourceVersion: 'v2' }]);
    expect((await service.get(tenantId, candidateId, '1')).sources)
      .toEqual([{ sourceId: 'source-1', sourceVersion: 'v1' }]);
  });

  it('rejects unaccepted, stale, foreign-tenant and foreign-author writes with no version', async (): Promise<void> => {
    await expect(save(draft(), pendingId)).rejects.toMatchObject({ code: 'CONFLICT' });
    await expect(save(draft())).rejects.toMatchObject({ code: 'CONFLICT' });
    await expect(service.save({ ...draft(5), tenantId: otherTenant, candidateId, authorMemberId: otherMember }))
      .rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(service.save({ ...draft(5), tenantId, candidateId, authorMemberId: otherMember }))
      .rejects.toMatchObject({ code: 'UNAVAILABLE' });
    expect((await service.list(tenantId, candidateId)).latest?.version).toBe(5);
  });

  it('pages the whole immutable history without duplicates or body in summaries', async (): Promise<void> => {
    for (let index = 5; index < 23; index += 1) await save(draft(index));
    const first = await service.list(tenantId, candidateId);
    expect(first.history).toHaveLength(20); expect(first.nextBeforeVersion).toBe(4);
    expect(first.history[0]).not.toHaveProperty('body');
    const second = await service.list(tenantId, candidateId, String(first.nextBeforeVersion));
    expect(second.history.map((item) => item.version)).toEqual([3, 2, 1]);
    expect(second.latest?.version).toBe(23); expect(second.nextBeforeVersion).toBeNull();
  });

  it('reads saved content through a fresh connection', async (): Promise<void> => {
    const fresh: Sql = postgres(databaseUrl!, { max: 1 });
    try {
      expect((await new PostgresPlaybookAuthoringRepository(fresh).get({ tenantId, candidateId, version: 23 }))?.body)
        .toBe(draft().body);
    } finally { await fresh.end({ timeout: 1 }); }
  });

  it('includes the largest supported version in the first history page', async (): Promise<void> => {
    const id: string = await createCandidate();
    const input: SavePlaybookDraftRequest = draft(2147483646);
    await sql`INSERT INTO playbook_draft_versions (
      tenant_id, candidate_id, version, expected_version, request_id, author_member_id,
      title, body, applicability, change_note, source_refs
    ) VALUES (${tenantId}::uuid, ${id}::uuid, 2147483647, 2147483646,
      ${input.requestId}::uuid, ${memberId}::uuid, ${input.title}, ${input.body},
      ${input.applicability}, ${input.changeNote}, '[]'::jsonb)`;
    const result = await service.list(tenantId, id);
    expect(result.latest?.version).toBe(2147483647);
    expect(result.history.map((item) => item.version)).toEqual([2147483647]);
    expect((await service.list(tenantId, id, '2147483647')).history).toEqual([]);
  });

  it.each(['', 'expired', 'denied'])('protects all HTTP routes from identity %s', async (token): Promise<void> => {
    const expected: number = token === 'denied' ? 403 : 401;
    for (const [path, body] of [['', undefined], ['/versions/1', undefined], ['/versions', draft(23)]] as const) {
      const response = await http(path, token, body);
      expect(response.status).toBe(expected);
      expect(response.headers.get('cache-control')).toBe('no-store');
    }
  });

  it('injects identity and ignores forged sources and author fields over HTTP', async (): Promise<void> => {
    const input = draft(23);
    const response = await http('/versions', 'a', { ...input, tenantId: otherTenant,
      authorMemberId: otherMember, sources: [{ sourceId: 'forged' }], candidateId: pendingId });
    expect(response.status).toBe(201);
    expect(response.headers.get('cache-control')).toBe('no-store');
    const body = await response.json();
    expect(body).toMatchObject({ candidateId, authorMemberId: memberId, version: 24,
      sources: [{ sourceId: 'source-1', sourceVersion: 'v2' }] });
    expect((await http('/versions', 'a', input)).status).toBe(201);
    expect((await http('/versions', 'a', draft(23))).status).toBe(409);
  });

  it('validates cursors, body, missing versions and tenant visibility over HTTP', async (): Promise<void> => {
    expect((await http('', 'b')).status).toBe(404);
    expect((await http('/versions/1', 'b')).status).toBe(404);
    expect((await http('/versions', 'b', draft())).status).toBe(404);
    expect((await http('/versions/999')).status).toBe(404);
    expect((await http('?beforeVersion=1.5')).status).toBe(422);
    expect((await http('?beforeVersion[]=1')).status).toBe(422);
    expect((await http('/versions', 'a', {})).status).toBe(422);
    expect((await http('/versions', 'a', { ...draft(24), body: 'short' })).status).toBe(422);
    const result = await http('/versions/1');
    expect(result.status).toBe(200); expect((await result.json()).version).toBe(1);
  });

  it('enforces review permissions, tenant scope, CAS, immutable history, and idempotent replay', async (): Promise<void> => {
    const initial = await reviewHttp(reviewCandidateId);
    expect(initial.status).toBe(200);
    expect(initial.headers.get('cache-control')).toBe('no-store');
    expect(await initial.json()).toMatchObject({ latestDraftVersion: 1, status: 'not_submitted', history: [] });
    expect((await reviewHttp(reviewCandidateId, '')).status).toBe(401);
    expect((await reviewHttp(reviewCandidateId, 'denied')).status).toBe(403);
    expect((await reviewHttp(reviewCandidateId, 'b')).status).toBe(404);

    const first: RecordPlaybookDraftReviewRequest = reviewRequest(1, 0, 'submit', '已核对适用范围和来源证据');
    const concurrent: RecordPlaybookDraftReviewRequest = reviewRequest(1, 0, 'submit', '并发审核也应由 CAS 阻止');
    const results = await Promise.all([
      reviewHttp(reviewCandidateId, 'a', first), reviewHttp(reviewCandidateId, 'a', concurrent),
    ]);
    expect(results.map((result) => result.status).sort()).toEqual([201, 409]);
    const acceptedInput: RecordPlaybookDraftReviewRequest = results[0].status === 201 ? first : concurrent;
    const acceptedResponse: Response = results[0].status === 201 ? results[0] : results[1];
    const acceptedEvent = await acceptedResponse.json();
    expect(acceptedEvent).toMatchObject({ candidateId: reviewCandidateId, version: 1, sequence: 1,
      action: 'submit', actorMemberId: memberId, note: acceptedInput.note });
    expect(acceptedResponse.headers.get('cache-control')).toBe('no-store');
    expect(await (await reviewHttp(reviewCandidateId, 'a', acceptedInput)).json()).toEqual(acceptedEvent);
    expect((await reviewHttp(reviewCandidateId, 'a', { ...acceptedInput, note: '重用请求编号但改变说明' })).status).toBe(409);

    const approve: RecordPlaybookDraftReviewRequest = reviewRequest(1, 1, 'approve', '审核通过');
    expect((await reviewHttp(reviewCandidateId, 'a', approve)).status).toBe(403);
    const approved = await reviewHttp(reviewCandidateId, 'admin', approve);
    expect(approved.status).toBe(201);
    expect(approved.headers.get('cache-control')).toBe('no-store');
    expect(await approved.json()).toMatchObject({ sequence: 2, action: 'approve', actorMemberId: adminMember });
    expect((await reviewHttp(reviewCandidateId, 'admin', reviewRequest(1, 2, 'approve', '重复批准'))).status).toBe(409);

    await saveReviewDraft(1);
    expect(await reviewService.list(tenantId, reviewCandidateId)).toMatchObject({
      latestDraftVersion: 2, status: 'superseded', current: { version: 1, action: 'approve' },
    });
    expect((await reviewHttp(reviewCandidateId, 'admin', reviewRequest(1, 2, 'approve', '不能批准旧版本'))).status).toBe(409);
    const submitV2: RecordPlaybookDraftReviewRequest = reviewRequest(2, 2, 'submit', '第二版已复核');
    expect((await reviewHttp(reviewCandidateId, 'a', submitV2)).status).toBe(201);
    const returned = await reviewHttp(reviewCandidateId, 'admin', reviewRequest(2, 3, 'request_changes', '补充验收责任和边界'));
    expect(returned.status).toBe(201);
    expect(await returned.json()).toMatchObject({ sequence: 4, action: 'request_changes', actorMemberId: adminMember });

    await saveReviewDraft(2);
    let sequence = 4;
    for (let version = 3; version <= 13; version += 1) {
      if (version > 3) await saveReviewDraft(version - 1);
      const submitted = await reviewHttp(reviewCandidateId, 'a', reviewRequest(version, sequence, 'submit', `第 ${version} 版提交`));
      expect(submitted.status).toBe(201);
      sequence += 1;
      const decided = await reviewHttp(reviewCandidateId, 'admin', reviewRequest(version, sequence, 'approve', `第 ${version} 版通过`));
      expect(decided.status).toBe(201);
      sequence += 1;
    }
    const firstPage = await reviewHttp(reviewCandidateId);
    const page = await firstPage.json();
    expect(page).toMatchObject({ latestDraftVersion: 13, status: 'approved', nextBeforeSequence: 7 });
    expect(page.history).toHaveLength(20);
    const olderPage = await reviewHttp(reviewCandidateId, 'a', undefined, page.nextBeforeSequence);
    expect((await olderPage.json()).history.map((event: { sequence: number }) => event.sequence)).toEqual([6, 5, 4, 3, 2, 1]);
    await expect(sql`DELETE FROM playbook_draft_versions
      WHERE tenant_id = ${tenantId}::uuid AND candidate_id = ${reviewCandidateId}::uuid AND version = 1`)
      .rejects.toMatchObject({ code: '23503' });
  });

  it('retains author audit until candidate or tenant cleanup and cascades draft history', async (): Promise<void> => {
    await expect(sql`DELETE FROM tenant_members WHERE tenant_id = ${tenantId}::uuid AND id = ${memberId}::uuid`)
      .rejects.toMatchObject({ code: '23503' });
    await sql`DELETE FROM agent_tenants WHERE id = ${tenantId}::uuid`;
    const rows = await sql`SELECT version FROM playbook_draft_versions WHERE tenant_id = ${tenantId}::uuid`;
    expect(rows).toHaveLength(0);
  });
});
