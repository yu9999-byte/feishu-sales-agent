import {
  BadRequestException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { MODULE_METADATA } from '@nestjs/common/constants';
import { describe, expect, it, vi } from 'vitest';

import type {
  StaleOpportunityReminderExecutionResponse,
  StaleOpportunityReminderPlanResponse,
} from '@shared/api.interface';
import type { AgentRuntimeConfig } from '@server/config/agent.config';
import {
  StaleOpportunityReminderRuntimeController,
  type StaleOpportunityReminderRuntimeExecutionRunner,
  type StaleOpportunityReminderRuntimePlanRunner,
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
    execution: {
      enabled: false,
      triggerToken: undefined,
      allowedTenantId: undefined,
      allowedMemberId: undefined,
      allowedRecipientOpenId: undefined,
    },
  },
});

const response: StaleOpportunityReminderRuntimePreparationResult = {
  status: 'disabled',
  checkedAt: NOW,
  reasons: [],
  uncertainDeliveryFound: false,
};

const planResponse: StaleOpportunityReminderPlanResponse = {
  mode: 'plan-only',
  status: 'disabled',
  generatedAt: NOW,
  preflight: response,
  scanTraceId: null,
  summary: { candidateCount: 0, suppressedCandidateCount: 0 },
  items: [],
  warnings: [],
};

const planRunner = (): StaleOpportunityReminderRuntimePlanRunner => ({
  plan: vi.fn(async (): Promise<StaleOpportunityReminderPlanResponse> =>
    planResponse),
});

const executionResponse: StaleOpportunityReminderExecutionResponse = {
  mode: 'controlled-delivery',
  status: 'disabled',
  generatedAt: NOW,
  planTraceId: null,
  candidate: null,
  outcome: null,
  warnings: [],
};

const executionRunner = (): StaleOpportunityReminderRuntimeExecutionRunner => ({
  execute: vi.fn(
    async (): Promise<StaleOpportunityReminderExecutionResponse> =>
      executionResponse,
  ),
});

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
      planRunner(),
      executionRunner(),
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
      planRunner(),
      executionRunner(),
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
      planRunner(),
      executionRunner(),
    );

    await expect(controller.preflight('Bearer correct-trigger-token'))
      .resolves.toEqual(response);
    expect(prepare).toHaveBeenCalledTimes(1);
  });

  it('rejects an invalid plan credential before planning', async (): Promise<void> => {
    const prepare = vi.fn(async (): Promise<StaleOpportunityReminderRuntimePreparationResult> =>
      response);
    const plan = vi.fn(async (): Promise<StaleOpportunityReminderPlanResponse> =>
      planResponse);
    const controller = new StaleOpportunityReminderRuntimeController(
      runtimeConfig('correct-trigger-token'),
      { prepare },
      { plan },
      executionRunner(),
    );

    await expect(controller.plan('Bearer wrong-trigger-token')).rejects
      .toBeInstanceOf(UnauthorizedException);
    expect(plan).not.toHaveBeenCalled();
    expect(prepare).not.toHaveBeenCalled();
  });

  it('returns a plan-only result for the dedicated token', async (): Promise<void> => {
    const prepare = vi.fn(async (): Promise<StaleOpportunityReminderRuntimePreparationResult> =>
      response);
    const plan = vi.fn(async (): Promise<StaleOpportunityReminderPlanResponse> =>
      planResponse);
    const controller = new StaleOpportunityReminderRuntimeController(
      runtimeConfig('correct-trigger-token'),
      { prepare },
      { plan },
      executionRunner(),
    );

    await expect(controller.plan('Bearer correct-trigger-token'))
      .resolves.toEqual(planResponse);
    expect(plan).toHaveBeenCalledTimes(1);
    expect(prepare).not.toHaveBeenCalled();
  });

  it('uses a separate execution credential before parsing input', async (): Promise<void> => {
    const config: AgentRuntimeConfig = runtimeConfig('scan-token');
    config.staleOpportunityReminder!.execution!.triggerToken =
      'execution-token';
    const execute = vi.fn(
      async (): Promise<StaleOpportunityReminderExecutionResponse> =>
        executionResponse,
    );
    const controller = new StaleOpportunityReminderRuntimeController(
      config,
      { prepare: vi.fn() },
      planRunner(),
      { execute },
    );

    await expect(controller.execute({}, 'Bearer scan-token')).rejects
      .toBeInstanceOf(UnauthorizedException);
    expect(execute).not.toHaveBeenCalled();
  });

  it('rejects extra caller-controlled execution fields', async (): Promise<void> => {
    const config: AgentRuntimeConfig = runtimeConfig();
    config.staleOpportunityReminder!.execution!.triggerToken =
      'execution-token';
    const execute = vi.fn(
      async (): Promise<StaleOpportunityReminderExecutionResponse> =>
        executionResponse,
    );
    const controller = new StaleOpportunityReminderRuntimeController(
      config,
      { prepare: vi.fn() },
      planRunner(),
      { execute },
    );

    await expect(controller.execute({
      opportunityRecordId: 'opportunity-1',
      followupVersion: 'version-1',
      recipientOpenId: 'ou_attacker',
    }, 'Bearer execution-token')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(execute).not.toHaveBeenCalled();
  });

  it('accepts only the exact candidate key for execution', async (): Promise<void> => {
    const config: AgentRuntimeConfig = runtimeConfig();
    config.staleOpportunityReminder!.execution!.triggerToken =
      'execution-token';
    const execute = vi.fn(
      async (): Promise<StaleOpportunityReminderExecutionResponse> =>
        executionResponse,
    );
    const controller = new StaleOpportunityReminderRuntimeController(
      config,
      { prepare: vi.fn() },
      planRunner(),
      { execute },
    );
    const request = {
      opportunityRecordId: 'opportunity-1',
      followupVersion: 'version-1',
    };

    await expect(controller.execute(request, 'Bearer execution-token'))
      .resolves.toEqual(executionResponse);
    expect(execute).toHaveBeenCalledWith(request);
  });
});
