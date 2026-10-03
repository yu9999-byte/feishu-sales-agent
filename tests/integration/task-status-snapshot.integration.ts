import { config as loadEnvironment } from 'dotenv';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { Sql } from 'postgres';
import { PostgresControlStore } from
  '@server/modules/control-store/postgres-control.store';
import type { TaskStatusSnapshot } from
  '@server/modules/agent-core/agent.types';

loadEnvironment({
  path: ['.env.local', '.env'],
  quiet: true,
});

const TENANT_ID: string = '10000000-0000-4000-8000-00000000000d';
const ACTOR_OPEN_ID: string = 'ou_snapshot_sales';
const databaseUrl: string | undefined = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error('DATABASE_URL is required for task snapshot integration tests');
}

const sql: Sql = postgres(databaseUrl, {
  max: 2,
  connect_timeout: 10,
  idle_timeout: 5,
  onnotice: (): void => undefined,
});

const firstSnapshot: TaskStatusSnapshot = {
  guid: 'task-snapshot-1',
  title: '准备报价说明',
  status: 'todo',
  completedAt: null,
  dueAt: '2026-10-02T02:00:00.000Z',
  url: 'https://example.com/task-snapshot-1',
};

describe('PostgresControlStore task status snapshots', (): void => {
  beforeAll(async (): Promise<void> => {
    await sql`DELETE FROM agent_tenants WHERE id = ${TENANT_ID}::uuid`;
    await sql`
      INSERT INTO agent_tenants (
        id, feishu_tenant_key, name, status
      ) VALUES (
        ${TENANT_ID}::uuid, 'snapshot-integration-tenant', '任务快照测试企业', 'active'
      )
    `;
  });

  afterAll(async (): Promise<void> => {
    await sql`DELETE FROM agent_tenants WHERE id = ${TENANT_ID}::uuid`;
    await sql.end({ timeout: 5 });
  });

  it('persists a baseline and returns deterministic change evidence', async (): Promise<void> => {
    const store: PostgresControlStore = new PostgresControlStore(sql);
    const first: TaskStatusSnapshot[] = [firstSnapshot];
    await expect(store.recordTaskSnapshots(
      TENANT_ID,
      ACTOR_OPEN_ID,
      new Date('2026-10-01T02:00:00.000Z'),
      first,
    )).resolves.toEqual([]);

    const changes = await store.recordTaskSnapshots(
      TENANT_ID,
      ACTOR_OPEN_ID,
      new Date('2026-10-02T02:00:00.000Z'),
      [{
        ...firstSnapshot,
        title: '重新安排报价说明',
        dueAt: '2026-10-05T02:00:00.000Z',
      }],
    );
    expect(changes).toEqual([
      expect.objectContaining({
        guid: firstSnapshot.guid,
        kind: 'changed',
        previousTitle: firstSnapshot.title,
        currentTitle: '重新安排报价说明',
        previousDueAt: firstSnapshot.dueAt,
        currentDueAt: '2026-10-05T02:00:00.000Z',
      }),
    ]);

    const completionChanges = await store.recordTaskSnapshots(
      TENANT_ID,
      ACTOR_OPEN_ID,
      new Date('2026-10-03T02:00:00.000Z'),
      [{
        ...firstSnapshot,
        title: '重新安排报价说明',
        status: 'completed',
        completedAt: '2026-10-03T01:30:00.000Z',
        dueAt: '2026-10-05T02:00:00.000Z',
      }],
    );
    expect(completionChanges).toEqual([
      expect.objectContaining({
        guid: firstSnapshot.guid,
        kind: 'completed',
        previousCompletedAt: null,
        currentCompletedAt: '2026-10-03T01:30:00.000Z',
      }),
    ]);

    const reopenedChanges = await store.recordTaskSnapshots(
      TENANT_ID,
      ACTOR_OPEN_ID,
      new Date('2026-10-04T02:00:00.000Z'),
      [{
        ...firstSnapshot,
        title: '重新安排报价说明',
        status: 'todo',
        completedAt: null,
        dueAt: '2026-10-06T02:00:00.000Z',
      }],
    );
    expect(reopenedChanges).toEqual([
      expect.objectContaining({
        guid: firstSnapshot.guid,
        kind: 'reopened',
        previousCompletedAt: '2026-10-03T01:30:00.000Z',
        currentCompletedAt: null,
      }),
    ]);

    const events = await store.listTaskStatusEvents(
      TENANT_ID,
      ACTOR_OPEN_ID,
      [firstSnapshot.guid],
      new Date('2026-10-01T00:00:00.000Z'),
      20,
    );
    expect(events.warning).toBeUndefined();
    expect(events.items.map((event) => event.kind)).toEqual([
      'reopened', 'completed', 'changed', 'observed',
    ]);
    expect(events.items[0]).toMatchObject({
      guid: firstSnapshot.guid,
      previousCompletedAt: '2026-10-03T01:30:00.000Z',
      completedAt: null,
    });
  });
});
