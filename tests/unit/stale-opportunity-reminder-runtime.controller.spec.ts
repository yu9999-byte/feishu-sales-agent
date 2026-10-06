import {
  BadRequestException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { MODULE_METADATA } from '@nestjs/common/constants';
import { describe, expect, it, vi } from 'vitest';

import type {
  StaleOpportunityReminderExecutionReadinessResponse,
  StaleOpportunityReminderExecutionResponse,
  StaleOpportunityReminderPlanResponse,
  StaleOpportunityReminderScheduleObservationResponse,
} from '@shared/api.interface';
import type { AgentRuntimeConfig } from '@server/config/agent.config';
import {
  StaleOpportunityReminderRuntimeController,
  type StaleOpportunityReminderRuntimeExecutionRunner,
  type StaleOpportunityReminderRuntimePlanRunner,
  type StaleOpportunityReminderRuntimePreflightRunner,
  type StaleOpportunityReminderScheduleObservationRunner,
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
    scheduleObservation: {
      triggerToken: undefined,
    },
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

const executionReadinessResponse:
  StaleOpportunityReminderExecutionReadinessResponse = {
    mode: 'read-only',
    status: 'blocked',
    checkedAt: NOW,
    configuration: {
      executionEnabled: false,
      reminderEnabled: false,
      scanEnabled: false,
      executionTokenConfigured: true,
      scanTokenConfigured: false,
      executionTokenDistinctFromScan: false,
      allowlistConfigured: false,
      historyGovernanceReady: false,
      senderConfigured: false,
    },
    target: {
      tenantId: null,
      tenantName: null,
      tenantStatus: 'not_configured',
      memberId: null,
      memberDisplayName: null,
      memberStatus: 'not_configured',
      recipientOpenId: null,
      recipientOpenIdMatches: null,
      permissionGranted: null,
      dataSourceConfigured: null,
    },
    historyGovernance: {
      status: 'not_checked',
      checkedAt: NOW,
      summary: {
        opportunityCount: 0,
        statusConfirmedCount: 0,
        statusNeedsConfirmationCount: 0,
        followupTimeConfirmedCount: 0,
        followupTimeNeedsConfirmationCount: 0,
        readyForScanCount: 0,
      },
      pendingItems: [],
      warnings: [],
    },
    senderEvidence: {
      status: 'not_checked',
      checkedAt: NOW,
      credentialsStatus: 'not_checked',
      botStatus: 'not_checked',
      botOpenIdPresent: false,
      sendPermissionStatus: 'not_checked',
      grantedSendScope: null,
      recipientVisibility: {
        status: 'not_checked',
        inspectionPermissionGranted: false,
      },
      warnings: [],
    },
    ledger: { status: 'not_checked', uncertainDeliveryFound: false },
    candidateProbe: {
      status: 'disabled',
      traceId: null,
      candidateCount: 0,
      matchingCandidateCount: 0,
      items: [],
      warnings: [],
    },
    blockers: ['scan_disabled'],
    warnings: [],
  };

const scheduleObservationResponse:
  StaleOpportunityReminderScheduleObservationResponse = {
    mode: 'read-only-observation',
    traceId: 'schedule-observation-trace',
    status: 'blocked',
    observedAt: NOW,
    blockers: ['history_governance_incomplete'],
    summary: {
      executionReadinessStatus: 'blocked',
      blockerCount: 1,
      warningCount: 0,
      historyGovernanceStatus: 'incomplete',
      senderEvidenceStatus: 'complete',
      ledgerStatus: 'clear',
      candidateProbeStatus: 'complete',
      candidateCount: 0,
      matchingCandidateCount: 0,
    },
    auditRecorded: true,
    warnings: [],
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

  it('rejects scan and invalid credentials before readiness inspection', async (): Promise<void> => {
    const config: AgentRuntimeConfig = runtimeConfig('scan-token');
    config.staleOpportunityReminder!.execution!.triggerToken =
      'execution-token';
    const inspect = vi.fn(
      async (): Promise<StaleOpportunityReminderExecutionReadinessResponse> =>
        executionReadinessResponse,
    );
    const controller = new StaleOpportunityReminderRuntimeController(
      config,
      { prepare: vi.fn() },
      planRunner(),
      executionRunner(),
      { inspect },
    );

    await expect(controller.executionReadinessCheck()).rejects
      .toBeInstanceOf(UnauthorizedException);
    await expect(controller.executionReadinessCheck('Bearer scan-token'))
      .rejects.toBeInstanceOf(UnauthorizedException);
    expect(inspect).not.toHaveBeenCalled();
  });

  it('inspects readiness with the execution credential while delivery is off', async (): Promise<void> => {
    const config: AgentRuntimeConfig = runtimeConfig('scan-token');
    config.staleOpportunityReminder!.execution!.triggerToken =
      'execution-token';
    const inspect = vi.fn(
      async (): Promise<StaleOpportunityReminderExecutionReadinessResponse> =>
        executionReadinessResponse,
    );
    const execute = vi.fn(
      async (): Promise<StaleOpportunityReminderExecutionResponse> =>
        executionResponse,
    );
    const controller = new StaleOpportunityReminderRuntimeController(
      config,
      { prepare: vi.fn() },
      planRunner(),
      { execute },
      { inspect },
    );

    await expect(
      controller.executionReadinessCheck('Bearer execution-token'),
    ).resolves.toEqual(executionReadinessResponse);
    expect(config.staleOpportunityReminder?.execution?.enabled).toBe(false);
    expect(inspect).toHaveBeenCalledTimes(1);
    expect(execute).not.toHaveBeenCalled();
  });

  it('rejects schedule observation before inspection when its token is missing', async (): Promise<void> => {
    const observe = vi.fn(async (): Promise<
      StaleOpportunityReminderScheduleObservationResponse
    > => scheduleObservationResponse);
    const scheduleObserver:
      StaleOpportunityReminderScheduleObservationRunner = { observe };
    const controller = new StaleOpportunityReminderRuntimeController(
      runtimeConfig('scan-token'),
      { prepare: vi.fn() },
      planRunner(),
      executionRunner(),
      undefined,
      scheduleObserver,
    );

    await expect(
      controller.observeSchedule('Bearer supplied-token'),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(observe).not.toHaveBeenCalled();
  });

  it.each(['scan', 'execution'] as const)(
    'rejects a schedule token reused from %s',
    async (source): Promise<void> => {
      const config: AgentRuntimeConfig = runtimeConfig('scan-token');
      config.staleOpportunityReminder!.execution!.triggerToken =
        'execution-token';
      config.staleOpportunityReminder!.scheduleObservation!.triggerToken =
        source === 'scan' ? 'scan-token' : 'execution-token';
      const observe = vi.fn(async (): Promise<
        StaleOpportunityReminderScheduleObservationResponse
      > => scheduleObservationResponse);
      const controller = new StaleOpportunityReminderRuntimeController(
        config,
        { prepare: vi.fn() },
        planRunner(),
        executionRunner(),
        undefined,
        { observe },
      );

      await expect(
        controller.observeSchedule(
          `Bearer ${config.staleOpportunityReminder
            ?.scheduleObservation?.triggerToken}`,
        ),
      ).rejects.toBeInstanceOf(ServiceUnavailableException);
      expect(observe).not.toHaveBeenCalled();
    },
  );

  it('uses only the dedicated observation token and never invokes delivery', async (): Promise<void> => {
    const config: AgentRuntimeConfig = runtimeConfig('scan-token');
    config.staleOpportunityReminder!.execution!.triggerToken =
      'execution-token';
    config.staleOpportunityReminder!.scheduleObservation!.triggerToken =
      'schedule-observation-token';
    const execute = vi.fn(
      async (): Promise<StaleOpportunityReminderExecutionResponse> =>
        executionResponse,
    );
    const observe = vi.fn(async (): Promise<
      StaleOpportunityReminderScheduleObservationResponse
    > => scheduleObservationResponse);
    const controller = new StaleOpportunityReminderRuntimeController(
      config,
      { prepare: vi.fn() },
      planRunner(),
      { execute },
      undefined,
      { observe },
    );

    await expect(controller.observeSchedule()).rejects
      .toBeInstanceOf(UnauthorizedException);
    await expect(controller.observeSchedule('Bearer scan-token')).rejects
      .toBeInstanceOf(UnauthorizedException);
    await expect(
      controller.observeSchedule('Bearer execution-token'),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(
      controller.observeSchedule('Bearer schedule-observation-token'),
    ).resolves.toEqual(scheduleObservationResponse);
    expect(observe).toHaveBeenCalledTimes(1);
    expect(execute).not.toHaveBeenCalled();
  });
});
