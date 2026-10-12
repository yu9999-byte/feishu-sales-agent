import {
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';

import type { AgentRuntimeConfig } from '@server/config/agent.config';
import { ProactiveSalesNotificationController } from
  '@server/modules/insight/proactive-sales-notification.controller';

const response = {
  mode: 'scheduler-run' as const,
  status: 'plan_only' as const,
  generatedAt: '2026-10-12T01:05:00.000Z',
  summary: {
    tenantCount: 1, memberCount: 1, plannedCount: 1,
    sentCount: 0, skippedCount: 0, failedCount: 0,
  },
  warnings: [],
};

const config = (token: string | undefined): AgentRuntimeConfig => ({
  host: '127.0.0.1', port: 3100, databaseUrl: 'postgres://unused',
  llm: { baseUrl: 'https://llm.example.com', apiKey: 'key', model: 'glm' },
  feishu: { verificationToken: 'verify', encryptKey: undefined },
  proactiveSalesNotifications: {
    enabled: true, deliveryEnabled: false, triggerToken: token,
    webPublicUrl: 'https://agent.example.com',
  },
});

describe('ProactiveSalesNotificationController', (): void => {
  it('rejects missing configuration and invalid credentials before running', async (): Promise<void> => {
    const run = vi.fn();
    await expect(new ProactiveSalesNotificationController(
      config(undefined), { run },
    ).run('Bearer anything')).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
    await expect(new ProactiveSalesNotificationController(
      config('scheduler-token'), { run },
    ).run('Bearer wrong')).rejects.toBeInstanceOf(UnauthorizedException);
    expect(run).not.toHaveBeenCalled();
  });

  it('rejects reuse of a stale-opportunity credential', async (): Promise<void> => {
    const run = vi.fn();
    const unsafe: AgentRuntimeConfig = config('shared-token');
    unsafe.staleOpportunityScan = {
      enabled: true,
      triggerToken: 'shared-token',
    };
    await expect(new ProactiveSalesNotificationController(
      unsafe, { run },
    ).run('Bearer shared-token')).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
    expect(run).not.toHaveBeenCalled();
  });

  it('runs only with the dedicated bearer token', async (): Promise<void> => {
    const run = vi.fn(async () => response);
    await expect(new ProactiveSalesNotificationController(
      config('scheduler-token'), { run },
    ).run('Bearer scheduler-token')).resolves.toEqual(response);
    expect(run).toHaveBeenCalledOnce();
  });
});
