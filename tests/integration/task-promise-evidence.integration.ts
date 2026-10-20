import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import postgres, { type Sql, type JSONValue } from 'postgres';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { TaskPromiseEvidenceController } from '@server/modules/insight/task-promise-evidence.controller';
import { TaskPromiseEvidenceService } from '@server/modules/insight/task-promise-evidence.service';
import { PostgresTaskPromiseEvidenceRepository } from '@server/modules/insight/postgres-task-promise-evidence.repository';
import { TASK_PROMISE_EVIDENCE_REPOSITORY, type TaskPromiseEvidenceInput } from
  '@server/modules/insight/task-promise-evidence.ports';
import { PlatformShellService } from '@server/modules/platform-shell/platform-shell.service';
import { PlatformAccessDeniedError } from '@server/modules/platform-shell/platform-session.service';
import { FeishuWebAuthError, FeishuWebAuthService } from '@server/modules/web-auth/feishu-web-auth.service';

const databaseUrl: string | undefined = process.env.DATABASE_URL;
describe.skipIf(!databaseUrl)('promise evidence PostgreSQL and HTTP', () => {
  const sql: Sql = postgres(databaseUrl!, { max: 6, onnotice: () => undefined });
  const tenantId: string = randomUUID(); const otherTenant: string = randomUUID();
  const memberId: string = randomUUID(); const otherMember: string = randomUUID();
  const repository = new PostgresTaskPromiseEvidenceRepository(sql);
  const service = new TaskPromiseEvidenceService(repository);
  let app: INestApplication; let baseUrl: string;
  const owner = (actionId: string) => ({ tenantId, actionId, actorOpenId: memberId });
  const input = (actionId: string, expectedRevision = 0): TaskPromiseEvidenceInput => ({
    ...owner(actionId), actorMemberId: memberId, requestId: randomUUID(), expectedRevision,
    state: 'reported_fulfilled', note: '已经交付最终方案', evidenceUrl: 'https://example.feishu.cn/docx/abc',
  });
  const createAction = async (patch: { status?: string; payload?: JSONValue; result?: JSONValue } = {}): Promise<string> => {
    const actionId: string = randomUUID();
    await sql`INSERT INTO pending_actions (tenant_id, id, actor_open_id, chat_id, status, payload, result, expires_at)
      VALUES (${tenantId}::uuid, ${actionId}::uuid, ${memberId}, 'isolated-chat', ${patch.status ?? 'succeeded'},
        ${sql.json(patch.payload ?? { actionKind: 'followup', draft: { nextAction: '交付最终方案' } })},
        ${sql.json(patch.result ?? {})}, now() + interval '1 day')`;
    return actionId;
  };
  const http = (actionId: string, token = 'a', body?: unknown, before?: string): Promise<Response> => fetch(
    `${baseUrl}/api/platform/task-promises/${actionId}/evidence${before === undefined ? '' : `?beforeRevision=${before}`}`,
    { method: body === undefined ? 'GET' : 'POST', headers: { 'content-type': 'application/json',
      ...(token ? { cookie: `sales-agent-session=${token}` } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }) },
  );

  beforeAll(async () => {
    await sql`INSERT INTO agent_tenants (id, feishu_tenant_key, name, status) VALUES
      (${tenantId}::uuid, ${tenantId}, '隔离凭证 A', 'active'), (${otherTenant}::uuid, ${otherTenant}, '隔离凭证 B', 'active')`;
    await sql`INSERT INTO tenant_members (tenant_id, id, feishu_open_id, display_name, status) VALUES
      (${tenantId}::uuid, ${memberId}::uuid, ${memberId}, '本人', 'active'),
      (${otherTenant}::uuid, ${otherMember}::uuid, ${otherMember}, '另一租户', 'active')`;
    class EvidenceTestModule {}
    app = await NestFactory.create({ module: EvidenceTestModule, controllers: [TaskPromiseEvidenceController],
      providers: [TaskPromiseEvidenceService, { provide: TASK_PROMISE_EVIDENCE_REPOSITORY, useValue: repository },
        { provide: FeishuWebAuthService, useValue: { authenticateSession: async (token: string) => {
          if (token === 'expired') throw new FeishuWebAuthError('UNAUTHENTICATED', 'expired');
          return { tenantId: token === 'b' ? otherTenant : tenantId, tokenHash: token,
            member: { id: token === 'b' ? otherMember : memberId,
              feishuOpenId: token === 'foreign' ? 'ou-foreign' : token === 'b' ? otherMember : memberId } };
        } } },
        { provide: PlatformShellService, useValue: { assertPermission:
          async (session: { tokenHash: string }, permission: string): Promise<void> => {
            if (session.tokenHash === 'denied' || (permission === 'followup:create-own' && session.tokenHash === 'reader')) {
              throw new PlatformAccessDeniedError();
            }
          } } },
      ] }, { logger: false });
    await app.listen(0, '127.0.0.1'); baseUrl = await app.getUrl();
  });
  afterAll(async () => {
    try { if (app) await app.close();
      await sql`DELETE FROM agent_tenants WHERE id IN (${tenantId}::uuid, ${otherTenant}::uuid)`;
    } finally { await sql.end({ timeout: 2 }); }
  });

  it('serializes competing writes and never changes the original promise', async () => {
    const id: string = await createAction();
    const before = await sql`SELECT payload, result, status, updated_at FROM pending_actions WHERE id = ${id}::uuid`;
    const results = await Promise.allSettled([service.record(input(id)), service.record(input(id))]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
    expect((await service.list(owner(id))).history).toHaveLength(1);
    expect(await sql`SELECT payload, result, status, updated_at FROM pending_actions WHERE id = ${id}::uuid`).toEqual(before);
  });
  it('replays concurrent and delayed requests but rejects changed parameters', async () => {
    const id: string = await createAction(); const request = input(id);
    const events = await Promise.all([service.record(request), service.record(request)]);
    expect(events[0]).toEqual(events[1]); await service.record(input(id, 1));
    expect(await service.record(request)).toEqual(events[0]);
    for (const patch of [{ note: '变更原说明' }, { evidenceUrl: 'https://example.feishu.cn/wiki/xyz' },
      { state: 'reported_partial' as const }, { expectedRevision: 1 }]) {
      await expect(service.record({ ...request, ...patch })).rejects.toMatchObject({ code: 'CONFLICT' });
    }
    expect((await service.list(owner(id))).history).toHaveLength(2);
  });
  it('appends retraction without erasing older evidence and persists across connections', async () => {
    const id: string = await createAction(); const first = await service.record(input(id));
    const retracted = await service.record({ ...input(id, 1), state: 'retracted', note: '原凭证需要重新核查', evidenceUrl: null });
    const fresh: Sql = postgres(databaseUrl!, { max: 1 });
    try {
      const read = new TaskPromiseEvidenceService(new PostgresTaskPromiseEvidenceRepository(fresh));
      expect(await read.list(owner(id))).toMatchObject({ revision: 2, current: retracted, history: [retracted, first] });
    } finally { await fresh.end(); }
  });
  it('pages the append history without duplicates while retaining the latest state', async () => {
    const id: string = await createAction();
    for (let revision = 0; revision < 23; revision += 1) await service.record(input(id, revision));
    const first = await service.list(owner(id)); expect(first.history).toHaveLength(20); expect(first.nextBeforeRevision).toBe(4);
    const second = await service.list(owner(id), '4'); expect(second.history.map((event) => event.revision)).toEqual([3, 2, 1]);
    expect(second.revision).toBe(23); expect(second.nextBeforeRevision).toBeNull();
  });
  it('requires the exact tenant and owner for reads and writes', async () => {
    const id: string = await createAction();
    for (const patch of [{ tenantId: otherTenant }, { actorOpenId: 'foreign-owner' }]) {
      await expect(service.list({ ...owner(id), ...patch })).rejects.toMatchObject({ code: 'NOT_FOUND' });
      await expect(service.record({ ...input(id), ...patch })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    }
    expect((await service.list(owner(id))).revision).toBe(0);
  });
  it('rejects tasks, non-followup actions, failures and missing promises', async () => {
    for (const patch of [{ result: { taskGuid: 'guid-task' } }, { status: 'failed' },
      { payload: { actionKind: 'task', draft: { nextAction: '交付方案' } } },
      { payload: { draft: { nextAction: '暂无下一步' } } }, { payload: { draft: {} } }]) {
      const id: string = await createAction(patch);
      await expect(service.record(input(id))).rejects.toMatchObject({ code: 'CONFLICT' });
      await expect(service.list(owner(id))).rejects.toMatchObject({ code: 'CONFLICT' });
    }
  });
  it('revalidates qualification after obtaining the original action lock', async () => {
    const id: string = await createAction(); let write: Promise<unknown> | undefined;
    await sql.begin(async (tx) => {
      await tx`UPDATE pending_actions SET result = '{"taskGuid":"new-task"}'::jsonb WHERE id = ${id}::uuid`;
      write = service.record(input(id)).catch((error: unknown) => error);
    });
    expect(await write).toMatchObject({ code: 'CONFLICT' });
    expect(await sql`SELECT revision FROM task_promise_evidence_events WHERE action_id = ${id}::uuid`).toHaveLength(0);
  });
  it.each(['', 'expired', 'denied', 'reader', 'foreign', 'b'])(
    'enforces session and write permissions over HTTP: %s', async (token) => {
      const id: string = await createAction();
      const expected: number = !token || token === 'expired' ? 401 : ['denied', 'reader'].includes(token) ? 403 : 404;
      const response = await http(id, token, input(id));
      expect(response.status).toBe(expected); expect(response.headers.get('cache-control')).toBe('no-store');
      const read = await http(id, token); expect(read.status).toBe(token === 'reader' ? 200 : expected);
      expect(read.headers.get('cache-control')).toBe('no-store');
    },
  );
  it('uses session identity and returns validation/conflict errors without writes', async () => {
    const id: string = await createAction(); const request = input(id);
    const response = await http(id, 'a', { ...request, tenantId: otherTenant, actorOpenId: otherMember, actorMemberId: otherMember });
    expect(response.status).toBe(201); expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toMatchObject({ actorMemberId: memberId, actionId: id, revision: 1 });
    expect((await http(id, 'a', request)).status).toBe(201);
    expect((await http(id, 'a', input(id))).status).toBe(409);
    expect((await http(id, 'a', { ...input(id, 1), evidenceUrl: 'https://evil.example/docx/a' })).status).toBe(422);
    expect((await http(id, 'a', undefined, '0')).status).toBe(422);
    expect((await service.list(owner(id))).revision).toBe(1);
  });
  it('sanitizes repository faults on both HTTP routes', async () => {
    const id: string = await createAction();
    const read = vi.spyOn(repository, 'list').mockRejectedValueOnce(new Error('database password=secret at internal-host'));
    const response = await http(id); expect(response.status).toBe(503);
    expect(response.headers.get('cache-control')).toBe('no-store'); expect(await response.text()).not.toContain('secret');
    read.mockRestore();
    const write = vi.spyOn(repository, 'record').mockRejectedValueOnce(new Error('database password=secret at internal-host'));
    const failed = await http(id, 'a', input(id)); expect(failed.status).toBe(503);
    expect(failed.headers.get('cache-control')).toBe('no-store'); expect(await failed.text()).not.toContain('internal-host');
    write.mockRestore();
  });
});
