import { afterEach, describe, expect, it, vi } from 'vitest';

import { loadAgentConfig } from '@server/config/agent.config';

const requiredEnvironment = (): void => {
  vi.stubEnv('DATABASE_URL', 'postgres://test');
  vi.stubEnv('LLM_BASE_URL', 'https://llm.example.test');
  vi.stubEnv('LLM_API_KEY', 'test-key');
  vi.stubEnv('LLM_MODEL', 'test-model');
  vi.stubEnv('FEISHU_VERIFICATION_TOKEN', 'verification-token');
};

describe('loadAgentConfig controlled reminder execution', (): void => {
  afterEach((): void => {
    vi.unstubAllEnvs();
  });

  it('keeps real reminder execution disabled and unscoped by default', (): void => {
    requiredEnvironment();

    const reminder = loadAgentConfig().staleOpportunityReminder;

    expect(reminder?.scheduleObservation).toEqual({
      triggerToken: undefined,
    });
    expect(reminder?.execution).toEqual({
      enabled: false,
      triggerToken: undefined,
      allowedTenantId: undefined,
      allowedMemberId: undefined,
      allowedRecipientOpenId: undefined,
    });
  });

  it('loads the dedicated execution token and exact allowlist', (): void => {
    requiredEnvironment();
    vi.stubEnv('STALE_OPPORTUNITY_REMINDER_EXECUTION_ENABLED', 'true');
    vi.stubEnv(
      'STALE_OPPORTUNITY_REMINDER_EXECUTION_TOKEN',
      'execution-token',
    );
    vi.stubEnv(
      'STALE_OPPORTUNITY_REMINDER_ALLOWED_TENANT_ID',
      'tenant-a',
    );
    vi.stubEnv(
      'STALE_OPPORTUNITY_REMINDER_ALLOWED_MEMBER_ID',
      'member-a',
    );
    vi.stubEnv(
      'STALE_OPPORTUNITY_REMINDER_ALLOWED_RECIPIENT_OPEN_ID',
      'ou_sales_a',
    );

    expect(loadAgentConfig().staleOpportunityReminder?.execution).toEqual({
      enabled: true,
      triggerToken: 'execution-token',
      allowedTenantId: 'tenant-a',
      allowedMemberId: 'member-a',
      allowedRecipientOpenId: 'ou_sales_a',
    });
  });

  it('loads a dedicated read-only schedule observation token', (): void => {
    requiredEnvironment();
    vi.stubEnv(
      'STALE_OPPORTUNITY_REMINDER_SCHEDULE_OBSERVATION_TOKEN',
      'schedule-observation-token',
    );

    expect(
      loadAgentConfig().staleOpportunityReminder?.scheduleObservation,
    ).toEqual({
      triggerToken: 'schedule-observation-token',
    });
  });
});

describe('loadAgentConfig proactive sales notifications', (): void => {
  afterEach((): void => {
    vi.unstubAllEnvs();
  });

  it('keeps planning and real delivery disabled by default', (): void => {
    requiredEnvironment();

    expect(loadAgentConfig().proactiveSalesNotifications).toEqual({
      enabled: false,
      deliveryEnabled: false,
      triggerToken: undefined,
      webPublicUrl: undefined,
      enabledKinds: [],
      allowedTenantId: undefined,
      allowedMemberId: undefined,
      allowedRecipientOpenId: undefined,
    });
  });

  it('loads its dedicated token and normalizes the public web URL', (): void => {
    requiredEnvironment();
    vi.stubEnv('PROACTIVE_SALES_NOTIFICATIONS_ENABLED', 'true');
    vi.stubEnv('PROACTIVE_SALES_NOTIFICATIONS_DELIVERY_ENABLED', 'true');
    vi.stubEnv(
      'PROACTIVE_SALES_NOTIFICATION_TRIGGER_TOKEN',
      'proactive-trigger-token',
    );
    vi.stubEnv(
      'PROACTIVE_SALES_NOTIFICATION_WEB_PUBLIC_URL',
      'https://agent.example.com///',
    );
    vi.stubEnv(
      'PROACTIVE_SALES_NOTIFICATION_ENABLED_KINDS',
      'daily_report,weekly_team',
    );
    vi.stubEnv('PROACTIVE_SALES_NOTIFICATION_ALLOWED_TENANT_ID', 'tenant-a');
    vi.stubEnv('PROACTIVE_SALES_NOTIFICATION_ALLOWED_MEMBER_ID', 'member-a');
    vi.stubEnv(
      'PROACTIVE_SALES_NOTIFICATION_ALLOWED_RECIPIENT_OPEN_ID',
      'ou_sales_a',
    );

    expect(loadAgentConfig().proactiveSalesNotifications).toEqual({
      enabled: true,
      deliveryEnabled: true,
      triggerToken: 'proactive-trigger-token',
      webPublicUrl: 'https://agent.example.com',
      enabledKinds: ['daily_report', 'weekly_team'],
      allowedTenantId: 'tenant-a',
      allowedMemberId: 'member-a',
      allowedRecipientOpenId: 'ou_sales_a',
    });
  });

  it('rejects unknown proactive notification kinds', (): void => {
    requiredEnvironment();
    vi.stubEnv(
      'PROACTIVE_SALES_NOTIFICATION_ENABLED_KINDS',
      'daily_report,unknown_kind',
    );

    expect((): void => {
      loadAgentConfig();
    }).toThrow('PROACTIVE_SALES_NOTIFICATION_ENABLED_KINDS');
  });
});
