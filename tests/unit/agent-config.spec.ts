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

    expect(loadAgentConfig().staleOpportunityReminder?.execution).toEqual({
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
});
