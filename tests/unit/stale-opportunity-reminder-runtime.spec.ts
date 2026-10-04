import { MODULE_METADATA } from '@nestjs/common/constants';
import { describe, expect, it, vi } from 'vitest';

import type { AgentRuntimeConfig } from '@server/config/agent.config';
import {
  StaleOpportunityReminderRuntimeService,
} from '@server/modules/insight/stale-opportunity-reminder-runtime.service';
import {
  StaleOpportunityReadinessModule,
} from '@server/modules/insight/stale-opportunity-readiness.module';
import {
  PostgresStaleOpportunityReminderStore,
} from '@server/modules/insight/postgres-stale-opportunity-reminder.store';
import type {
  StaleOpportunityReminderUncertainRecord,
} from '@server/modules/insight/stale-opportunity-reminder.service';

const NOW: Date = new Date('2026-10-04T02:00:00.000Z');

const runtimeConfig = (
  overrides: Partial<NonNullable<AgentRuntimeConfig['staleOpportunityScan']>> & {
    reminderEnabled?: boolean;
    historyGovernanceReady?: boolean;
    senderConfigured?: boolean;
  } = {},
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
    enabled: overrides.enabled ?? false,
    triggerToken: overrides.triggerToken,
  },
  staleOpportunityReminder: {
    enabled: overrides.reminderEnabled ?? false,
    historyGovernanceReady: overrides.historyGovernanceReady ?? false,
    senderConfigured: overrides.senderConfigured ?? false,
  },
});

const uncertainRecord: StaleOpportunityReminderUncertainRecord = {
  tenantId: '00000000-0000-4000-8000-00000000000a',
  opportunityRecordId: 'opportunity-1',
  followupVersion: 'followup-v1',
  reminderKind: 'stale_followup',
  opportunityName: '北辰数字化项目',
  ownerOpenId: 'ou_sales_a',
  attemptCount: 1,
  dispatchStartedAt: '2026-10-04T02:00:00.000Z',
  failureCode: 'REMINDER_DELIVERY_UNKNOWN',
  failureMessage: 'delivery outcome not verified',
  updatedAt: '2026-10-04T02:00:00.000Z',
};

describe('StaleOpportunityReminderRuntimeService', (): void => {
  it('registers the runtime gate and read-only ledger reader', (): void => {
    const providers: unknown = Reflect.getMetadata(
      MODULE_METADATA.PROVIDERS,
      StaleOpportunityReadinessModule,
    );

    expect(providers).toEqual(expect.arrayContaining([
      StaleOpportunityReminderRuntimeService,
      PostgresStaleOpportunityReminderStore,
    ]));
  });

  it('stays disabled and does not read reconciliation when delivery is off', async (): Promise<void> => {
    const listUncertain = vi.fn(async (): Promise<StaleOpportunityReminderUncertainRecord[]> => []);
    const service = new StaleOpportunityReminderRuntimeService(
      runtimeConfig(),
      { listUncertain },
    );

    await expect(service.prepare({ now: NOW })).resolves.toEqual({
      status: 'disabled',
      checkedAt: NOW.toISOString(),
      reasons: [],
      uncertainDeliveryFound: false,
    });
    expect(listUncertain).not.toHaveBeenCalled();
  });

  it('blocks before reconciliation when a static prerequisite is missing', async (): Promise<void> => {
    const listUncertain = vi.fn();
    const service = new StaleOpportunityReminderRuntimeService(
      runtimeConfig({ reminderEnabled: true }),
      { listUncertain },
    );

    await expect(service.prepare({ now: NOW })).resolves.toEqual({
      status: 'blocked',
      checkedAt: NOW.toISOString(),
      reasons: [
        'scan_disabled',
        'trigger_token_missing',
        'history_governance_incomplete',
        'sender_unconfigured',
      ],
      uncertainDeliveryFound: false,
    });
    expect(listUncertain).not.toHaveBeenCalled();
  });

  it('blocks when an uncertain delivery is present', async (): Promise<void> => {
    const listUncertain = vi.fn(async (): Promise<StaleOpportunityReminderUncertainRecord[]> => [
      uncertainRecord,
    ]);
    const service = new StaleOpportunityReminderRuntimeService(
      runtimeConfig({
        enabled: true,
        triggerToken: 'trigger-token',
        reminderEnabled: true,
        historyGovernanceReady: true,
        senderConfigured: true,
      }),
      { listUncertain },
    );

    await expect(service.prepare({ now: NOW })).resolves.toEqual({
      status: 'blocked',
      checkedAt: NOW.toISOString(),
      reasons: ['uncertain_delivery_present'],
      uncertainDeliveryFound: true,
    });
    expect(listUncertain).toHaveBeenCalledWith({ limit: 1 });
  });

  it('blocks when uncertain reconciliation is unavailable', async (): Promise<void> => {
    const listUncertain = vi.fn(async (): Promise<StaleOpportunityReminderUncertainRecord[]> => {
      throw new Error('database unavailable');
    });
    const service = new StaleOpportunityReminderRuntimeService(
      runtimeConfig({
        enabled: true,
        triggerToken: 'trigger-token',
        reminderEnabled: true,
        historyGovernanceReady: true,
        senderConfigured: true,
      }),
      { listUncertain },
    );

    await expect(service.prepare({ now: NOW })).resolves.toEqual({
      status: 'blocked',
      checkedAt: NOW.toISOString(),
      reasons: ['reconciliation_unavailable'],
      uncertainDeliveryFound: false,
    });
  });

  it('is ready only after every prerequisite and reconciliation check passes', async (): Promise<void> => {
    const listUncertain = vi.fn(async (): Promise<StaleOpportunityReminderUncertainRecord[]> => []);
    const service = new StaleOpportunityReminderRuntimeService(
      runtimeConfig({
        enabled: true,
        triggerToken: 'trigger-token',
        reminderEnabled: true,
        historyGovernanceReady: true,
        senderConfigured: true,
      }),
      { listUncertain },
    );

    await expect(service.prepare({ now: NOW })).resolves.toEqual({
      status: 'ready',
      checkedAt: NOW.toISOString(),
      reasons: [],
      uncertainDeliveryFound: false,
    });
  });
});
