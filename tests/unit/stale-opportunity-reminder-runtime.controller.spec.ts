import {
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { MODULE_METADATA } from '@nestjs/common/constants';
import { describe, expect, it, vi } from 'vitest';

import type { AgentRuntimeConfig } from '@server/config/agent.config';
import {
  StaleOpportunityReminderRuntimeController,
  type StaleOpportunityReminderRuntimePreflightRunner,
} from '@server/modules/insight/stale-opportunity-reminder-runtime.controller';
import {
  StaleOpportunityReadinessModule,
} from '@server/modules/insight/stale-opportunity-readiness.module';
import type {
  StaleOpportunityReminderRuntimePreparationResult,
} from '@server/modules/insight/stale-opportunity-reminder-runtime.service';

const NOW: string = '2026-10-04T02:00:00.000Z';

const runtimeConfig = (
  triggerToken?: string,
): AgentRuntimeConfig => ({
  host: '127.0.0.1',
  port: 3100,
  databaseUrl: 'postgres://test',
  llm: {
    baseUrl: 'https://llm.example.test',
    apiKey: 'test-key',
    model: 'test-model',
  },
  feishu: {
    verificationToken: 'verification-token',
    encryptKey: undefined,
  },
  staleOpportunityScan: {
    enabled: false,
    triggerToken,
  },
  staleOpportunityReminder: {
    enabled: false,
    historyGovernanceReady: false,
    senderConfigured: false,
  },
});

const response: StaleOpportunityReminderRuntimePreparationResult = {
  status: 'disabled',
  checkedAt: NOW,
  reasons: [],
  uncertainDeliveryFound: false,
};

describe('StaleOpportunityReminderRuntimeController', (): void => {
  it('registers the protected preflight controller in the insight module', (): void => {
    const controllers: unknown = Reflect.getMetadata(
      MODULE_METADATA.CONTROLLERS,
      StaleOpportunityReadinessModule,
    );

    expect(controllers).toEqual(expect.arrayContaining([
      StaleOpportunityReminderRuntimeController,
    ]));
  });

  it('rejects the request before the runner when the token is not configured', async (): Promise<void> => {
    const prepare = vi.fn(async (): Promise<StaleOpportunityReminderRuntimePreparationResult> =>
      response);
    const runner: StaleOpportunityReminderRuntimePreflightRunner = { prepare };
    const controller = new StaleOpportunityReminderRuntimeController(
      runtimeConfig(),
      runner,
    );

    await expect(controller.preflight('Bearer supplied-token')).rejects
      .toBeInstanceOf(ServiceUnavailableException);
    expect(prepare).not.toHaveBeenCalled();
  });

  it('rejects missing and invalid credentials before any runtime check', async (): Promise<void> => {
    const prepare = vi.fn(async (): Promise<StaleOpportunityReminderRuntimePreparationResult> =>
      response);
    const runner: StaleOpportunityReminderRuntimePreflightRunner = { prepare };
    const controller = new StaleOpportunityReminderRuntimeController(
      runtimeConfig('correct-trigger-token'),
      runner,
    );

    await expect(controller.preflight()).rejects
      .toBeInstanceOf(UnauthorizedException);
    await expect(controller.preflight('Bearer wrong-trigger-token')).rejects
      .toBeInstanceOf(UnauthorizedException);
    expect(prepare).not.toHaveBeenCalled();
  });

  it('returns the safety-gate result for the dedicated token', async (): Promise<void> => {
    const prepare = vi.fn(async (): Promise<StaleOpportunityReminderRuntimePreparationResult> =>
      response);
    const runner: StaleOpportunityReminderRuntimePreflightRunner = { prepare };
    const controller = new StaleOpportunityReminderRuntimeController(
      runtimeConfig('correct-trigger-token'),
      runner,
    );

    await expect(controller.preflight('Bearer correct-trigger-token'))
      .resolves.toEqual(response);
    expect(prepare).toHaveBeenCalledTimes(1);
  });
});
