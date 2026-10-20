import 'reflect-metadata';
import { readFileSync } from 'node:fs';
import { ServiceUnavailableException } from '@nestjs/common';
import type { Sql } from 'postgres';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  AgentRuntimeHealthService,
  REQUIRED_AGENT_MIGRATIONS,
} from '@server/modules/insight/agent-runtime-health.service';
import { AgentRuntimeHealthController } from
  '@server/modules/insight/agent-runtime-health.controller';

const harness = (result: Promise<Array<{ filename: string }>>) => {
  const sql = vi.fn(() => result);
  const service = new AgentRuntimeHealthService({ begin: sql } as unknown as Sql);
  return { service, sql, controller: new AgentRuntimeHealthController(service) };
};

afterEach(() => vi.useRealTimers());

describe('Agent runtime health', () => {
  it('keeps liveness independent of the database', () => {
    const { controller, sql } = harness(Promise.resolve([]));
    expect(controller.live()).toEqual({ status: 'alive' });
    expect(sql).not.toHaveBeenCalled();
  });

  it('reports ready only when all runtime migrations exist', async () => {
    const { controller } = harness(Promise.resolve(
      REQUIRED_AGENT_MIGRATIONS.map((filename: string) => ({ filename })),
    ));
    expect(await controller.ready()).toEqual({
      status: 'ready', database: 'ready', checkedAt: expect.any(String),
    });
  });

  it('keeps the readiness migration requirements in sync with the migrator', () => {
    const source: string = readFileSync('scripts/migrate-agent.cjs', 'utf8');
    const filenames: string[] = Array.from(
      source.matchAll(/'([0-9]{3}_[a-z_]+\.sql)'/gu),
      (match: RegExpExecArray): string => match[1],
    );
    expect([...REQUIRED_AGENT_MIGRATIONS]).toEqual(filenames);
  });

  it('returns 503 when the database exists but migrations are incomplete', async () => {
    const { controller } = harness(Promise.resolve(
      REQUIRED_AGENT_MIGRATIONS.slice(0, -1).map((filename: string) => ({ filename })),
    ));
    try {
      await controller.ready();
      expect.unreachable('Expected not ready');
    } catch (error: unknown) {
      expect(error).toBeInstanceOf(ServiceUnavailableException);
      expect((error as ServiceUnavailableException).getResponse()).toEqual({
        status: 'not_ready', database: 'schema_pending', checkedAt: expect.any(String),
      });
    }
  });

  it('sanitizes database failures and allows recovery on the next request', async () => {
    const { controller, sql } = harness(Promise.resolve([]));
    sql.mockImplementationOnce(() => Object.assign(
      Promise.reject(new Error('postgres://secret:password@private-host/db')),
      { cancel: vi.fn() },
    ));
    await expect(controller.ready()).rejects.toMatchObject({
      response: { status: 'not_ready', database: 'unavailable' }, status: 503,
    });
    sql.mockImplementationOnce(() => Object.assign(Promise.resolve(
      REQUIRED_AGENT_MIGRATIONS.map((filename: string) => ({ filename })),
    ), { cancel: vi.fn() }));
    expect(await controller.ready()).toMatchObject({ status: 'ready' });
    expect(sql).toHaveBeenCalledTimes(2);
  });

  it('bounds a hanging probe and shares it even after the HTTP deadline', async () => {
    vi.useFakeTimers();
    let settle: (value: Array<{ filename: string }>) => void = (): void => undefined;
    const { service, sql } = harness(new Promise((resolve): void => { settle = resolve; }));
    const first = service.readiness();
    const second = service.readiness();
    expect(sql).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(2000);
    expect(await first).toMatchObject({ status: 'not_ready', database: 'unavailable' });
    expect(await second).toEqual(await first);
    expect(await service.readiness()).toEqual(await first);
    expect(sql).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
    settle(REQUIRED_AGENT_MIGRATIONS.map((filename: string) => ({ filename })));
    await vi.advanceTimersByTimeAsync(0);
    expect(await service.readiness()).toMatchObject({ status: 'ready' });
    expect(sql).toHaveBeenCalledTimes(2);
  });
});
