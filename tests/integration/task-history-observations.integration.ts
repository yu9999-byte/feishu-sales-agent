import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import postgres, { type Sql } from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { CONTROL_STORE } from '@server/modules/agent-core/agent.ports';
import type { TaskStatusSnapshot } from '@server/modules/agent-core/agent.types';
import { PostgresControlStore } from '@server/modules/control-store/postgres-control.store';
import { TaskFulfillmentController } from '@server/modules/insight/task-fulfillment.controller';
import { TaskFulfillmentService } from '@server/modules/insight/task-fulfillment.service';
import { PlatformShellService } from '@server/modules/platform-shell/platform-shell.service';
import { PlatformSessionService } from '@server/modules/platform-shell/platform-session.service';
import { FeishuWebAuthService } from '@server/modules/web-auth/feishu-web-auth.service';
import type { PendingActionPayload, TaskFulfillmentResponse } from '@shared/api.interface';
import { testIntegration } from '../fixtures/tenant-integration';

const databaseUrl: string | undefined = process.env.DATABASE_URL;
describe.skipIf(!databaseUrl)('task observation PostgreSQL and HTTP reconciliation', (): void => {
  const sql: Sql = postgres(databaseUrl!, { max: 2, connect_timeout: 5, onnotice: () => undefined });
  const store: PostgresControlStore = new PostgresControlStore(sql);
  const tenantId: string = randomUUID();
  const past: Date = new Date(Date.now() - 3_600_000);
  let app: INestApplication;
  let baseUrl: string;
  const snapshot: TaskStatusSnapshot = {
    guid: 'task-a', title: 'Deliver proposal', status: 'todo', completedAt: null, dueAt: null, url: null,
  };
  const payload: PendingActionPayload = {
    version: 1, sourceMessageId: 'isolated-message', rawText: 'Deliver proposal',
    draft: {
      customerName: null, contactName: null, opportunityName: null, summary: 'Proposal discussion',
      customerNeeds: [], objections: [], risks: [], progress: null, expectedAmount: null,
      nextAction: 'Deliver proposal', dueAt: null, evidenceQuotes: [],
    },
  };
  const seed = async (): Promise<string> => {
    const actor: string = randomUUID();
    const id: string = randomUUID();
    await store.createPendingAction({ id, tenantId, actorOpenId: actor, chatId: 'isolated-chat', payload,
      expiresAt: new Date(Date.now() + 86_400_000) });
    await store.saveExecutionResult(tenantId, id, 'succeeded', {
      pendingActionId: id, status: 'succeeded', taskGuid: snapshot.guid,
    });
    await store.recordTaskSnapshots(tenantId, actor, new Date(past.getTime() - 60_000), [snapshot]);
    return actor;
  };
  const complete = (completedAt: Date = past): TaskStatusSnapshot => ({
    ...snapshot, status: 'completed', completedAt: completedAt.toISOString(),
  });
  const read = async (actor: string): Promise<TaskFulfillmentResponse> => {
    const response: Response = await fetch(`${baseUrl}/api/platform/task-fulfillment`, {
      headers: { cookie: `sales-agent-session=${actor}` },
    });
    expect(response.status).toBe(200);
    return response.json();
  };
  const expectUnknown = (report: TaskFulfillmentResponse): void => {
    expect(report.status).toBe('partial');
    expect(report.promises[0]).toMatchObject({ status: 'task_lookup_unavailable', completionState: 'unknown' });
    expect(report.coverage.taskHistory).toBe('unavailable');
    expect(report.metrics.completedPromiseCount).toBe(0);
    expect(report.metrics.stillOpenPromiseCount).toBe(0);
    expect(report.changes).toEqual([]);
  };

  beforeAll(async (): Promise<void> => {
    await sql`INSERT INTO agent_tenants (id, feishu_tenant_key, name, status)
      VALUES (${tenantId}::uuid, ${tenantId}, 'Isolated history evidence', 'active')`;
    await sql`INSERT INTO tenant_integrations (tenant_id, app_id, app_secret_env, app_type, base_mapping, enabled)
      VALUES (${tenantId}::uuid, 'cli_isolated', 'ISOLATED_TEST_SECRET', 'selfBuild',
        ${JSON.stringify(testIntegration.base)}::text::jsonb, true)`;
    class HistoryTestModule {}
    app = await NestFactory.create({ module: HistoryTestModule, controllers: [TaskFulfillmentController], providers: [
      { provide: CONTROL_STORE, useValue: store },
      { provide: TaskFulfillmentService, useValue: new TaskFulfillmentService({
        listOwnedTasks: async () => ({ items: [] }), listCompletedTasks: async () => ({ items: [] }),
      }, store) },
      { provide: FeishuWebAuthService, useValue: { authenticateSession: async (actor: string) => ({
        tenantId, member: { id: actor, feishuOpenId: actor },
      }) } },
      { provide: PlatformShellService, useValue: { assertPermission: async () => undefined } },
      { provide: PlatformSessionService, useValue: { getSessionByMembership: async () => ({
        tenant: { timezone: 'Asia/Shanghai' },
      }) } },
    ] }, { logger: ['error'] });
    await app.listen(0, '127.0.0.1');
    baseUrl = await app.getUrl();
  });
  afterAll(async (): Promise<void> => {
    try {
      if (app) await app.close();
      await sql`DELETE FROM agent_tenants WHERE id = ${tenantId}::uuid`;
    } finally { await sql.end({ timeout: 2 }); }
  });

  it('preserves valid observed completion over HTTP', async (): Promise<void> => {
    const actor: string = await seed();
    await store.recordTaskSnapshots(tenantId, actor, past, [complete()]);
    const report: TaskFulfillmentResponse = await read(actor);
    expect(report.promises[0].completionState).toBe('completed');
    expect(report.metrics.completedPromiseCount).toBe(1);
    expect(report.coverage.taskHistory).toBe('agent_observations');
  });
  it('keeps future observation evidence unknown', async (): Promise<void> => {
    const actor: string = await seed();
    await store.recordTaskSnapshots(tenantId, actor, new Date(Date.now() + 86_400_000), [complete()]);
    expectUnknown(await read(actor));
  });
  it('keeps completion after its observation unknown', async (): Promise<void> => {
    const actor: string = await seed();
    await store.recordTaskSnapshots(tenantId, actor, past, [complete(new Date(past.getTime() + 60_000))]);
    expectUnknown(await read(actor));
  });
  it('rejects persisted contradictory states sharing a timestamp', async (): Promise<void> => {
    const actor: string = await seed();
    await store.recordTaskSnapshots(tenantId, actor, past, [complete()]);
    await store.recordTaskSnapshots(tenantId, actor, past, [snapshot]);
    expectUnknown(await read(actor));
  });
  it('preserves valid chronological reopening over HTTP', async (): Promise<void> => {
    const actor: string = await seed();
    await store.recordTaskSnapshots(tenantId, actor, past, [complete()]);
    await store.recordTaskSnapshots(tenantId, actor, new Date(past.getTime() + 60_000), [snapshot]);
    const report: TaskFulfillmentResponse = await read(actor);
    expect(report.promises[0]).toMatchObject({ status: 'open_changed', completionState: 'still_open' });
    expect(report.metrics.completedPromiseCount).toBe(0);
    expect(report.coverage.taskHistory).toBe('agent_observations');
  });
});
