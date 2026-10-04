import { MODULE_METADATA } from '@nestjs/common/constants';
import { describe, expect, it, vi } from 'vitest';

import type {
  StaleOpportunityReminderPlanResponse,
  StaleOpportunityTriggerCandidate,
} from '@shared/api.interface';
import type { AgentRuntimeConfig } from '@server/config/agent.config';
import type {
  StaleOpportunityReminderPreparationResult,
} from '@server/modules/insight/stale-opportunity-reminder-coordinator.service';
import {
  StaleOpportunityReminderExecutionService,
} from '@server/modules/insight/stale-opportunity-reminder-execution.service';
import {
  StaleOpportunityReadinessModule,
} from '@server/modules/insight/stale-opportunity-readiness.module';

const NOW: Date = new Date('2026-10-04T02:00:00.000Z');
const TRACE_ID: string = 'trace-reminder-execution';
const TENANT_ID: string = '00000000-0000-4000-8000-00000000000a';
const MEMBER_ID: string = 'member-a';
const OWNER_OPEN_ID: string = 'ou_sales_a';

const runtimeConfig = (
  overrides: Partial<NonNullable<
    NonNullable<AgentRuntimeConfig['staleOpportunityReminder']>['execution']
  >> = {},
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
    enabled: true,
    triggerToken: 'scan-token',
  },
  staleOpportunityReminder: {
    enabled: true,
    historyGovernanceReady: true,
    senderConfigured: true,
    execution: {
      enabled: true,
      triggerToken: 'execution-token',
      allowedTenantId: TENANT_ID,
      allowedMemberId: MEMBER_ID,
      allowedRecipientOpenId: OWNER_OPEN_ID,
      ...overrides,
    },
  },
});

const candidate = (
  overrides: Partial<StaleOpportunityTriggerCandidate> = {},
): StaleOpportunityTriggerCandidate => ({
  tenantId: TENANT_ID,
  memberId: MEMBER_ID,
  opportunityRecordId: 'opportunity-1',
  opportunityName: '北辰数字化项目',
  ownerOpenId: OWNER_OPEN_ID,
  followupRecordId: 'followup-1',
  lastEffectiveFollowupAt: '2026-09-20T02:00:00.000Z',
  followupVersion: 'version-1',
  ...overrides,
});

const plan = (
  status: StaleOpportunityReminderPlanResponse['status'],
  items: StaleOpportunityTriggerCandidate[] = [],
): StaleOpportunityReminderPlanResponse => ({
  mode: 'plan-only',
  status,
  generatedAt: NOW.toISOString(),
  preflight: {
    status: status === 'ready' ? 'ready' : status === 'disabled'
      ? 'disabled'
      : 'blocked',
    checkedAt: NOW.toISOString(),
    reasons: status === 'blocked' ? ['history_governance_incomplete'] : [],
    uncertainDeliveryFound: false,
  },
  scanTraceId: status === 'ready' ? TRACE_ID : null,
  summary: {
    candidateCount: items.length,
    suppressedCandidateCount: 0,
  },
  items,
  warnings: [],
});

const request = () => ({
  opportunityRecordId: 'opportunity-1',
  followupVersion: 'version-1',
  now: NOW,
});

describe('StaleOpportunityReminderExecutionService', (): void => {
  it('registers the controlled execution chain in the insight module', (): void => {
    const providers: unknown[] = Reflect.getMetadata(
      MODULE_METADATA.PROVIDERS,
      StaleOpportunityReadinessModule,
    );
    const tokens: unknown[] = providers.map((provider: unknown): unknown => {
      if (typeof provider !== 'object' || provider === null) return provider;
      return (provider as { provide?: unknown }).provide;
    });

    expect(tokens).toContain(StaleOpportunityReminderExecutionService);
  });

  it('does not plan or deliver while execution is disabled', async (): Promise<void> => {
    const planRun = vi.fn();
    const prepareAndDeliver = vi.fn();
    const service = new StaleOpportunityReminderExecutionService(
      runtimeConfig({ enabled: false }),
      { plan: planRun },
      { prepareAndDeliver },
    );

    await expect(service.execute(request())).resolves.toMatchObject({
      mode: 'controlled-delivery',
      status: 'disabled',
      candidate: null,
      outcome: null,
    });
    expect(planRun).not.toHaveBeenCalled();
    expect(prepareAndDeliver).not.toHaveBeenCalled();
  });

  it.each([
    ['token', { triggerToken: undefined }],
    ['tenant', { allowedTenantId: undefined }],
    ['member', { allowedMemberId: undefined }],
    ['recipient', { allowedRecipientOpenId: undefined }],
  ] as const)(
    'blocks incomplete %s configuration before planning',
    async (_label, override): Promise<void> => {
      const planRun = vi.fn();
      const prepareAndDeliver = vi.fn();
      const service = new StaleOpportunityReminderExecutionService(
        runtimeConfig(override),
        { plan: planRun },
        { prepareAndDeliver },
      );

      await expect(service.execute(request())).resolves.toMatchObject({
        status: 'blocked',
        warnings: [
          'stale_opportunity_reminder_execution_config_incomplete',
        ],
      });
      expect(planRun).not.toHaveBeenCalled();
      expect(prepareAndDeliver).not.toHaveBeenCalled();
    },
  );

  it('blocks reuse of the read-only scan token for delivery', async (): Promise<void> => {
    const config: AgentRuntimeConfig = runtimeConfig();
    config.staleOpportunityReminder!.execution!.triggerToken = 'scan-token';
    const planRun = vi.fn();
    const prepareAndDeliver = vi.fn();
    const service = new StaleOpportunityReminderExecutionService(
      config,
      { plan: planRun },
      { prepareAndDeliver },
    );

    await expect(service.execute(request())).resolves.toMatchObject({
      status: 'blocked',
    });
    expect(planRun).not.toHaveBeenCalled();
    expect(prepareAndDeliver).not.toHaveBeenCalled();
  });

  it.each(['disabled', 'blocked', 'incomplete'] as const)(
    'does not deliver a %s plan',
    async (status): Promise<void> => {
      const prepareAndDeliver = vi.fn();
      const service = new StaleOpportunityReminderExecutionService(
        runtimeConfig(),
        { plan: vi.fn(async () => plan(status)) },
        { prepareAndDeliver },
      );

      await expect(service.execute(request())).resolves.toMatchObject({
        status,
        candidate: null,
        outcome: null,
      });
      expect(prepareAndDeliver).not.toHaveBeenCalled();
    },
  );

  it('requires exactly one current matching candidate', async (): Promise<void> => {
    const prepareAndDeliver = vi.fn();
    const noMatch = new StaleOpportunityReminderExecutionService(
      runtimeConfig(),
      { plan: vi.fn(async () => plan('ready', [candidate({
        followupVersion: 'new-version',
      })])) },
      { prepareAndDeliver },
    );
    const duplicate = candidate();
    const ambiguous = new StaleOpportunityReminderExecutionService(
      runtimeConfig(),
      { plan: vi.fn(async () => plan('ready', [duplicate, duplicate])) },
      { prepareAndDeliver },
    );

    await expect(noMatch.execute(request())).resolves.toMatchObject({
      status: 'candidate_not_found',
    });
    await expect(ambiguous.execute(request())).resolves.toMatchObject({
      status: 'candidate_ambiguous',
    });
    expect(prepareAndDeliver).not.toHaveBeenCalled();
  });

  it.each([
    ['tenant', { tenantId: '00000000-0000-4000-8000-00000000000b' }],
    ['member', { memberId: 'member-b' }],
    ['recipient', { ownerOpenId: 'ou_sales_b' }],
  ] as const)(
    'rejects a %s allowlist mismatch before delivery',
    async (_label, override): Promise<void> => {
      const prepareAndDeliver = vi.fn();
      const current: StaleOpportunityTriggerCandidate = candidate(override);
      const service = new StaleOpportunityReminderExecutionService(
        runtimeConfig(),
        { plan: vi.fn(async () => plan('ready', [current])) },
        { prepareAndDeliver },
      );

      await expect(service.execute(request())).resolves.toMatchObject({
        status: 'candidate_not_allowed',
        candidate: current,
        outcome: null,
      });
      expect(prepareAndDeliver).not.toHaveBeenCalled();
    },
  );

  it('delivers one exact allowed candidate after recheck', async (): Promise<void> => {
    const current: StaleOpportunityTriggerCandidate = candidate();
    const prepareAndDeliver = vi.fn(
      async (): Promise<StaleOpportunityReminderPreparationResult> => ({
        status: 'sent',
        reason: 'delivered',
        messageId: 'om_fake_reminder',
      }),
    );
    const service = new StaleOpportunityReminderExecutionService(
      runtimeConfig(),
      { plan: vi.fn(async () => plan('ready', [current])) },
      { prepareAndDeliver },
    );

    await expect(service.execute(request())).resolves.toEqual({
      mode: 'controlled-delivery',
      status: 'completed',
      generatedAt: NOW.toISOString(),
      planTraceId: TRACE_ID,
      candidate: current,
      outcome: {
        status: 'sent',
        reason: 'delivered',
        messageId: 'om_fake_reminder',
      },
      warnings: [],
    });
    expect(prepareAndDeliver).toHaveBeenCalledTimes(1);
    expect(prepareAndDeliver).toHaveBeenCalledWith({
      enabled: true,
      tenantId: TENANT_ID,
      memberId: MEMBER_ID,
      evidence: {
        opportunityRecordId: current.opportunityRecordId,
        opportunityName: current.opportunityName,
        ownerOpenId: current.ownerOpenId,
        followupRecordId: current.followupRecordId,
        lastEffectiveFollowupAt: current.lastEffectiveFollowupAt,
        followupVersion: current.followupVersion,
      },
      now: NOW,
    });
  });

  it('treats a cooldown as an idempotent completed repeat', async (): Promise<void> => {
    const current: StaleOpportunityTriggerCandidate = candidate();
    const prepareAndDeliver = vi.fn(
      async (): Promise<StaleOpportunityReminderPreparationResult> => ({
        status: 'skipped',
        reason: 'cooling_down',
        retryAt: '2026-10-11T02:00:00.000Z',
      }),
    );
    const service = new StaleOpportunityReminderExecutionService(
      runtimeConfig(),
      { plan: vi.fn(async () => plan('ready', [current])) },
      { prepareAndDeliver },
    );

    await expect(service.execute(request())).resolves.toMatchObject({
      status: 'completed',
      outcome: { status: 'skipped', reason: 'cooling_down' },
    });
    expect(prepareAndDeliver).toHaveBeenCalledTimes(1);
  });

  it.each([
    { status: 'failed', reason: 'delivery_unknown' },
    { status: 'skipped', reason: 'candidate_changed' },
  ] as const)(
    'halts after a non-repeatable $reason outcome',
    async (outcome): Promise<void> => {
      const current: StaleOpportunityTriggerCandidate = candidate();
      const prepareAndDeliver = vi.fn(async () => outcome);
      const service = new StaleOpportunityReminderExecutionService(
        runtimeConfig(),
        { plan: vi.fn(async () => plan('ready', [current])) },
        { prepareAndDeliver },
      );

      await expect(service.execute(request())).resolves.toMatchObject({
        status: 'halted',
        outcome,
        warnings: ['stale_opportunity_reminder_execution_halted'],
      });
      expect(prepareAndDeliver).toHaveBeenCalledTimes(1);
    },
  );
});
