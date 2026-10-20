import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import postgres, { type Sql } from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AGENT_DATABASE } from '@server/modules/control-store/postgres-control.store';
import { AgentRuntimeHealthController } from '@server/modules/insight/agent-runtime-health.controller';
import { AgentRuntimeHealthService, REQUIRED_AGENT_MIGRATIONS } from
  '@server/modules/insight/agent-runtime-health.service';

const databaseUrl: string | undefined = process.env.DATABASE_URL;

describe.skipIf(!databaseUrl)('Agent health over HTTP and PostgreSQL', (): void => {
  const schema: string = `health_${randomUUID().replaceAll('-', '')}`;
  const admin: Sql = postgres(databaseUrl!, { max: 2, onnotice: (): void => undefined });
  const sql: Sql = postgres(databaseUrl!, {
    max: 1, connection: { search_path: schema }, onnotice: (): void => undefined,
  });
  let app: INestApplication;
  let baseUrl: string;

  beforeAll(async (): Promise<void> => {
    await admin`CREATE SCHEMA ${admin(schema)}`;
    await sql`CREATE TABLE agent_schema_migrations (filename text PRIMARY KEY)`;
    class HealthTestModule {}
    app = await NestFactory.create({
      module: HealthTestModule,
      controllers: [AgentRuntimeHealthController],
      providers: [AgentRuntimeHealthService, { provide: AGENT_DATABASE, useValue: sql }],
    }, { logger: false });
    await app.listen(0, '127.0.0.1');
    baseUrl = await app.getUrl();
  });

  afterAll(async (): Promise<void> => {
    try {
      if (app) await app.close();
      await sql.end({ timeout: 1 });
      await admin`DROP SCHEMA IF EXISTS ${admin(schema)} CASCADE`;
    } finally {
      await admin.end({ timeout: 1 });
    }
  });

  it('returns live 200 and ready 503 for a connected but unmigrated database', async (): Promise<void> => {
    const live: Response = await fetch(`${baseUrl}/api/health/live`);
    expect(live.status).toBe(200);
    expect(live.headers.get('cache-control')).toBe('no-store');
    expect(await live.json()).toEqual({ status: 'alive' });
    const ready: Response = await fetch(`${baseUrl}/api/health/ready`);
    expect(ready.status).toBe(503);
    expect(ready.headers.get('cache-control')).toBe('no-store');
    expect(await ready.json()).toEqual({
      status: 'not_ready', database: 'schema_pending', checkedAt: expect.any(String),
    });
  });

  it('accepts the actual migrator ledger and detects one missing migration', async (): Promise<void> => {
    const applied = await admin<Array<{ filename: string }>>`
      SELECT filename FROM public.agent_schema_migrations ORDER BY filename
    `;
    expect(applied.map((row): string => row.filename)).toEqual([...REQUIRED_AGENT_MIGRATIONS]);
    await sql`INSERT INTO agent_schema_migrations ${sql(applied, 'filename')}`;
    expect((await fetch(`${baseUrl}/api/health/ready`)).status).toBe(200);
    const filename: string = REQUIRED_AGENT_MIGRATIONS[REQUIRED_AGENT_MIGRATIONS.length - 1];
    await sql`DELETE FROM agent_schema_migrations WHERE filename = ${filename}`;
    const pending: Response = await fetch(`${baseUrl}/api/health/ready`);
    expect(pending.status).toBe(503);
    expect(await pending.json()).toMatchObject({ database: 'schema_pending' });
    await sql`INSERT INTO agent_schema_migrations (filename) VALUES (${filename})`;
    expect((await fetch(`${baseUrl}/api/health/ready`)).status).toBe(200);
  });

  it('bounds a blocked query, keeps liveness responsive, and recovers after timeout', async (): Promise<void> => {
    let unlock: () => void = (): void => undefined;
    let signalLocked: () => void = (): void => undefined;
    const released = new Promise<void>((resolve): void => { unlock = resolve; });
    const locked = new Promise<void>((resolve): void => { signalLocked = resolve; });
    const blocker = admin.begin(async (transaction): Promise<void> => {
      await transaction`LOCK TABLE ${transaction(schema)}.agent_schema_migrations IN ACCESS EXCLUSIVE MODE`;
      signalLocked();
      await released;
    });
    try {
      await locked;
      const started: number = Date.now();
      const pending: Promise<Response> = fetch(`${baseUrl}/api/health/ready`);
      expect((await fetch(`${baseUrl}/api/health/live`)).status).toBe(200);
      const response: Response = await pending;
      expect(Date.now() - started).toBeLessThan(3500);
      expect(response.status).toBe(503);
      expect(await response.json()).toEqual({
        status: 'not_ready', database: 'unavailable', checkedAt: expect.any(String),
      });
    } finally {
      unlock();
      await blocker;
    }
    expect((await fetch(`${baseUrl}/api/health/ready`)).status).toBe(200);
  });

  it('keeps liveness alive after the database connection is shut down', async (): Promise<void> => {
    await sql.end({ timeout: 1 });
    const ready: Response = await fetch(`${baseUrl}/api/health/ready`);
    expect(ready.status).toBe(503);
    expect(await ready.json()).toEqual({
      status: 'not_ready', database: 'unavailable', checkedAt: expect.any(String),
    });
    expect((await fetch(`${baseUrl}/api/health/live`)).status).toBe(200);
  });
});
