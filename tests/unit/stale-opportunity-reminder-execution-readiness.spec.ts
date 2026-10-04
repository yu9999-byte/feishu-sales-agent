import { MODULE_METADATA } from '@nestjs/common/constants';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type {
  PlatformPermission,
  PlatformSessionResponse,
  StaleOpportunityTriggerCandidate,
  StaleOpportunityTriggerResponse,
} from '@shared/api.interface';
import type { AgentRuntimeConfig } from '@server/config/agent.config';
import type {
  TenantIntegration,
} from '@server/modules/agent-core/agent.types';
import type {
  PlatformMember,
} from '@server/modules/identity-access/identity-access.types';
import {
  StaleOpportunityReminderExecutionReadinessService,
} from '@server/modules/insight/stale-opportunity-reminder-execution-readiness.service';
import {
  StaleOpportunityReadinessModule,
} from '@server/modules/insight/stale-opportunity-readiness.module';

const NOW: Date = new Date('2026-10-05T02:00:00.000Z');
const TENANT_ID: string = '00000000-0000-4000-8000-00000000000a';
const MEMBER_ID: string = '00000000-0000-4000-8000-00000000000b';
const OPEN_ID: string = 'ou_sales_a';

interface ConfigOptions {
  executionEnabled?: boolean;
  reminderEnabled?: boolean;
  scanEnabled?: boolean;
  executionToken?: string;
  scanToken?: string;
  allowedTenantId?: string;
  allowedMemberId?: string;
  allowedRecipientOpenId?: string;
  historyGovernanceReady?: boolean;
  senderConfigured?: boolean;
}

interface HarnessOptions {
  config?: AgentRuntimeConfig;
  integration?: TenantIntegration | null;
  member?: PlatformMember | null;
  permissions?: PlatformPermission[];
  uncertain?: boolean;
  ledgerFails?: boolean;
  triggerResult?: StaleOpportunityTriggerResponse;
  triggerFails?: boolean;
}

interface Harness {
  service: StaleOpportunityReminderExecutionReadinessService;
  resolveTenantById: ReturnType<typeof vi.fn>;
  resolveMemberById: ReturnType<typeof vi.fn>;
  getSessionByMembership: ReturnType<typeof vi.fn>;
  listUncertain: ReturnType<typeof vi.fn>;
  run: ReturnType<typeof vi.fn>;
}

const runtimeConfig = (options: ConfigOptions = {}): AgentRuntimeConfig => ({
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
    enabled: options.scanEnabled ?? true,
    triggerToken: options.scanToken ?? 'scan-token',
  },
  staleOpportunityReminder: {
    enabled: options.reminderEnabled ?? false,
    historyGovernanceReady: options.historyGovernanceReady ?? true,
    senderConfigured: options.senderConfigured ?? true,
    execution: {
      enabled: options.executionEnabled ?? false,
      triggerToken: options.executionToken ?? 'execution-token',
      allowedTenantId: options.allowedTenantId ?? TENANT_ID,
      allowedMemberId: options.allowedMemberId ?? MEMBER_ID,
      allowedRecipientOpenId:
        options.allowedRecipientOpenId ?? OPEN_ID,
    },
  },
});

const integration = (
  status: TenantIntegration['status'] = 'active',
): TenantIntegration => ({
  tenantId: TENANT_ID,
  feishuTenantKey: 'tenant-key-a',
  name: '测试企业',
  status,
  appId: 'cli_test',
  appSecretEnv: 'TEST_FEISHU_SECRET',
  appType: 'selfBuild',
  base: {
    appToken: 'base-token',
    customers: {
      tableId: 'customers',
      primaryField: '客户名称',
      fields: { customerName: '客户名称' },
    },
    opportunities: {
      tableId: 'opportunities',
      primaryField: '商机名称',
      fields: {
        opportunityName: '商机名称',
        customerLink: '关联客户',
        ownerOpenId: '负责人',
        status: '商机状态',
      },
      statusValues: { active: ['进行中'] },
    },
    followups: {
      tableId: 'followups',
      primaryField: '跟进标题',
      fields: {
        sourceMessageId: '来源消息',
        customerLink: '关联客户',
        opportunityLink: '关联商机',
        rawText: '原文',
        summary: '摘要',
        ownerOpenId: '负责人',
        communicationAt: '沟通时间',
      },
    },
  },
});

const member = (
  status: PlatformMember['status'] = 'active',
  openId: string = OPEN_ID,
): PlatformMember => ({
  id: MEMBER_ID,
  tenantId: TENANT_ID,
  feishuOpenId: openId,
  displayName: '销售甲',
  status,
});

const candidate = (
  suffix: string = '1',
  overrides: Partial<StaleOpportunityTriggerCandidate> = {},
): StaleOpportunityTriggerCandidate => ({
  tenantId: TENANT_ID,
  memberId: MEMBER_ID,
  opportunityRecordId: `opportunity-${suffix}`,
  opportunityName: `测试商机 ${suffix}`,
  ownerOpenId: OPEN_ID,
  followupRecordId: `followup-${suffix}`,
  lastEffectiveFollowupAt: '2026-09-20T02:00:00.000Z',
  followupVersion: `version-${suffix}`,
  ...overrides,
});

const triggerResponse = (
  candidates: StaleOpportunityTriggerCandidate[] = [candidate()],
  status: StaleOpportunityTriggerResponse['status'] = 'complete',
): StaleOpportunityTriggerResponse => ({
  traceId: 'trace-readiness',
  generatedAt: NOW.toISOString(),
  mode: 'dry-run',
  status,
  summary: {
    tenantCount: 1,
    memberCount: 1,
    scannedMemberCount: status === 'complete' ? 1 : 0,
    skippedMemberCount: 0,
    incompleteMemberCount: status === 'incomplete' ? 1 : 0,
    candidateCount: status === 'complete' ? candidates.length : 0,
    suppressedCandidateCount:
      status === 'incomplete' ? candidates.length : 0,
    skipCount: 0,
  },
  candidates: status === 'complete' ? candidates : [],
  skips: [],
  audit: [],
  warnings: status === 'incomplete'
    ? ['stale_opportunity_batch_incomplete']
    : [],
});

const createHarness = (options: HarnessOptions = {}): Harness => {
  vi.stubEnv('TEST_FEISHU_SECRET', 'configured-secret');
  const selectedIntegration: TenantIntegration | null =
    options.integration === undefined ? integration() : options.integration;
  const selectedMember: PlatformMember | null =
    options.member === undefined ? member() : options.member;
  const permissions: PlatformPermission[] =
    options.permissions ?? ['review:read-personal'];
  const resolveTenantById = vi.fn(
    async (): Promise<TenantIntegration | null> => selectedIntegration,
  );
  const resolveMemberById = vi.fn(
    async (): Promise<PlatformMember | null> => selectedMember,
  );
  const getSessionByMembership = vi.fn(
    async (): Promise<PlatformSessionResponse> => {
      if (selectedIntegration === null || selectedMember === null) {
        throw new Error('missing target');
      }
      return {
        tenant: {
          id: selectedIntegration.tenantId,
          name: selectedIntegration.name,
          timezone: 'Asia/Shanghai',
        },
        member: {
          id: selectedMember.id,
          feishuOpenId: selectedMember.feishuOpenId,
          displayName: selectedMember.displayName,
        },
        roles: ['sales'],
        permissions,
        navigation: [],
        policyVersion: 'platform-authz-v1',
      };
    },
  );
  const listUncertain = vi.fn(async (): Promise<unknown[]> => {
    if (options.ledgerFails) throw new Error('ledger unavailable');
    return options.uncertain ? [{}] : [];
  });
  const run = vi.fn(async (): Promise<StaleOpportunityTriggerResponse> => {
    if (options.triggerFails) throw new Error('source unavailable');
    return options.triggerResult ?? triggerResponse();
  });
  const service = new StaleOpportunityReminderExecutionReadinessService(
    options.config ?? runtimeConfig(),
    { resolveTenantById },
    { resolveMemberById },
    { getSessionByMembership },
    { listUncertain },
    { run },
  );
  return {
    service,
    resolveTenantById,
    resolveMemberById,
    getSessionByMembership,
    listUncertain,
    run,
  };
};

describe('StaleOpportunityReminderExecutionReadinessService', (): void => {
  afterEach((): void => {
    vi.unstubAllEnvs();
  });

  it('registers the read-only readiness service', (): void => {
    const providers: unknown[] = Reflect.getMetadata(
      MODULE_METADATA.PROVIDERS,
      StaleOpportunityReadinessModule,
    );

    expect(providers).toEqual(expect.arrayContaining([
      StaleOpportunityReminderExecutionReadinessService,
    ]));
  });

  it('is ready for manual activation with one exact candidate', async (): Promise<void> => {
    const current: Harness = createHarness();

    await expect(current.service.inspect({ now: NOW })).resolves.toEqual({
      mode: 'read-only',
      status: 'ready_for_manual_activation',
      checkedAt: NOW.toISOString(),
      configuration: {
        executionEnabled: false,
        reminderEnabled: false,
        scanEnabled: true,
        executionTokenConfigured: true,
        scanTokenConfigured: true,
        executionTokenDistinctFromScan: true,
        allowlistConfigured: true,
        historyGovernanceReady: true,
        senderConfigured: true,
      },
      target: {
        tenantId: TENANT_ID,
        tenantName: '测试企业',
        tenantStatus: 'active',
        memberId: MEMBER_ID,
        memberDisplayName: '销售甲',
        memberStatus: 'active',
        recipientOpenId: OPEN_ID,
        recipientOpenIdMatches: true,
        permissionGranted: true,
        dataSourceConfigured: true,
      },
      ledger: { status: 'clear', uncertainDeliveryFound: false },
      candidateProbe: {
        status: 'complete',
        traceId: 'trace-readiness',
        candidateCount: 1,
        matchingCandidateCount: 1,
        items: [candidate()],
        warnings: [],
      },
      blockers: [],
      warnings: [],
    });
    expect(current.run).toHaveBeenCalledWith({
      now: NOW,
      traceId: undefined,
      tenantId: TENANT_ID,
      memberId: MEMBER_ID,
    });
  });

  it('reports missing and reused credentials without exposing either token', async (): Promise<void> => {
    const missingConfig: AgentRuntimeConfig = runtimeConfig();
    missingConfig.staleOpportunityReminder!.execution!.triggerToken =
      undefined;
    const missing: Harness = createHarness({ config: missingConfig });
    const reused: Harness = createHarness({
      config: runtimeConfig({ executionToken: 'scan-token' }),
    });

    const missingResult = await missing.service.inspect({ now: NOW });
    const reusedResult = await reused.service.inspect({ now: NOW });

    expect(missingResult.blockers).toContain('execution_token_missing');
    expect(reusedResult.blockers).toContain('execution_token_reused');
    expect(JSON.stringify([missingResult, reusedResult])).not.toContain(
      'scan-token',
    );
  });

  it('blocks when execution or reminder was enabled unexpectedly', async (): Promise<void> => {
    const current: Harness = createHarness({
      config: runtimeConfig({
        executionEnabled: true,
        reminderEnabled: true,
      }),
    });

    const result = await current.service.inspect({ now: NOW });

    expect(result.status).toBe('blocked');
    expect(result.blockers).toEqual(expect.arrayContaining([
      'execution_enabled',
      'reminder_enabled',
    ]));
  });

  it.each([
    {
      name: 'inactive tenant',
      options: { integration: integration('disabled') },
      blocker: 'target_tenant_inactive',
    },
    {
      name: 'inactive member',
      options: { member: member('disabled') },
      blocker: 'target_member_inactive',
    },
    {
      name: 'recipient mismatch',
      options: { member: member('active', 'ou_other') },
      blocker: 'recipient_open_id_mismatch',
    },
    {
      name: 'permission missing',
      options: { permissions: [] },
      blocker: 'permission_missing',
    },
  ] as const)(
    'blocks an invalid target: $name',
    async ({ options, blocker }): Promise<void> => {
      const current: Harness = createHarness(options);

      const result = await current.service.inspect({ now: NOW });

      expect(result.blockers).toContain(blocker);
      expect(result.candidateProbe.status).toBe('not_checked');
      expect(current.run).not.toHaveBeenCalled();
    },
  );

  it('blocks an unconfigured source before the candidate probe', async (): Promise<void> => {
    vi.stubEnv('TEST_FEISHU_SECRET', '');
    const current: Harness = createHarness();
    vi.stubEnv('TEST_FEISHU_SECRET', '');

    const result = await current.service.inspect({ now: NOW });

    expect(result.blockers).toContain('data_source_unconfigured');
    expect(result.candidateProbe.status).toBe('not_checked');
    expect(current.run).not.toHaveBeenCalled();
  });

  it.each([
    {
      name: 'uncertain record',
      options: { uncertain: true },
      blocker: 'uncertain_delivery_present',
      ledgerStatus: 'uncertain',
    },
    {
      name: 'unavailable ledger',
      options: { ledgerFails: true },
      blocker: 'reconciliation_unavailable',
      ledgerStatus: 'unavailable',
    },
  ] as const)(
    'blocks for $name',
    async ({ options, blocker, ledgerStatus }): Promise<void> => {
      const current: Harness = createHarness(options);

      const result = await current.service.inspect({ now: NOW });

      expect(result.blockers).toContain(blocker);
      expect(result.ledger.status).toBe(ledgerStatus);
    },
  );

  it('fails closed when the candidate source is incomplete', async (): Promise<void> => {
    const current: Harness = createHarness({
      triggerResult: triggerResponse([candidate()], 'incomplete'),
    });

    const result = await current.service.inspect({ now: NOW });

    expect(result.blockers).toContain('candidate_probe_incomplete');
    expect(result.candidateProbe).toMatchObject({
      status: 'incomplete',
      matchingCandidateCount: 0,
    });
  });

  it.each([
    {
      name: 'zero candidates',
      candidates: [],
      blocker: 'candidate_not_found',
    },
    {
      name: 'a non-allowlisted candidate',
      candidates: [candidate('other', { memberId: 'member-other' })],
      blocker: 'candidate_not_allowed',
    },
    {
      name: 'multiple matching candidates',
      candidates: [candidate('1'), candidate('2')],
      blocker: 'candidate_ambiguous',
    },
  ] as const)(
    'blocks $name',
    async ({ candidates, blocker }): Promise<void> => {
      const current: Harness = createHarness({
        triggerResult: triggerResponse([...candidates]),
      });

      const result = await current.service.inspect({ now: NOW });

      expect(result.blockers).toContain(blocker);
      expect(result.candidateProbe.candidateCount).toBe(candidates.length);
    },
  );
});
