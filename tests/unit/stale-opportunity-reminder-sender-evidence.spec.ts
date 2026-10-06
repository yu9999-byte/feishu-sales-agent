import { MODULE_METADATA } from '@nestjs/common/constants';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type {
  StaleOpportunityReminderSenderScope,
} from '@shared/api.interface';
import type { AgentRuntimeConfig } from '@server/config/agent.config';
import type {
  TenantIntegration,
} from '@server/modules/agent-core/agent.types';
import {
  FeishuClientFactory,
} from '@server/modules/feishu/feishu-client.factory';
import type {
  PlatformMember,
} from '@server/modules/identity-access/identity-access.types';
import {
  StaleOpportunityReadinessModule,
} from '@server/modules/insight/stale-opportunity-readiness.module';
import {
  StaleOpportunityReminderSenderEvidenceService,
} from '@server/modules/insight/stale-opportunity-reminder-sender-evidence.service';

const NOW: Date = new Date('2026-10-06T02:00:00.000Z');
const TENANT_ID: string = '00000000-0000-4000-8000-00000000000a';
const MEMBER_ID: string = '00000000-0000-4000-8000-00000000000b';
const OPEN_ID: string = 'ou_sales_a';

interface HarnessOptions {
  config?: AgentRuntimeConfig;
  integration?: TenantIntegration | null;
  member?: PlatformMember | null;
  botCode?: number;
  botEnabled?: boolean;
  botOpenId?: string;
  scopes?: string[];
  visibility?: 'visible' | 'not_visible' | 'failure';
}

interface Harness {
  service: StaleOpportunityReminderSenderEvidenceService;
  requestBotInfo: ReturnType<typeof vi.fn>;
  listScopes: ReturnType<typeof vi.fn>;
  checkVisibility: ReturnType<typeof vi.fn>;
}

const config = (
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
  staleOpportunityReminder: {
    enabled: false,
    historyGovernanceReady: false,
    senderConfigured: false,
    execution: {
      enabled: false,
      triggerToken: 'execution-token',
      allowedTenantId: TENANT_ID,
      allowedMemberId: MEMBER_ID,
      allowedRecipientOpenId: OPEN_ID,
      ...overrides,
    },
  },
});

const integration = (): TenantIntegration => ({
  tenantId: TENANT_ID,
  feishuTenantKey: 'tenant-key-a',
  name: '测试企业',
  status: 'active',
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
      },
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
      },
    },
  },
});

const member = (openId: string = OPEN_ID): PlatformMember => ({
  id: MEMBER_ID,
  tenantId: TENANT_ID,
  feishuOpenId: openId,
  displayName: '销售甲',
  status: 'active',
});

const createHarness = (options: HarnessOptions = {}): Harness => {
  vi.stubEnv('TEST_FEISHU_SECRET', 'configured-secret');
  const selectedIntegration: TenantIntegration | null =
    options.integration === undefined ? integration() : options.integration;
  const selectedMember: PlatformMember | null =
    options.member === undefined ? member() : options.member;
  const factory: FeishuClientFactory = new FeishuClientFactory();
  const client = factory.getClient(integration());
  const requestBotInfo = vi.spyOn(client, 'request').mockResolvedValue({
    code: options.botCode ?? 0,
    msg: options.botCode ? 'bot unavailable' : 'success',
    bot: {
      activate_status: options.botEnabled === false ? 1 : 2,
      open_id: options.botOpenId === undefined ? 'ou_bot' : options.botOpenId,
    },
  });
  const scopes: string[] = options.scopes ?? ['im:message:send_as_bot'];
  const listScopes = vi.spyOn(client.application.scope, 'list')
    .mockResolvedValue({
      code: 0,
      msg: 'success',
      data: {
        scopes: scopes.map((scope: string) => ({
          scope_name: scope,
          grant_status: 1,
          scope_type: 'tenant' as const,
        })),
      },
    });
  const checkVisibility = vi.spyOn(
    client.application.applicationVisibility,
    'checkWhiteBlackList',
  ).mockImplementation(async () => {
    if (options.visibility === 'failure') {
      throw new Error('visibility unavailable');
    }
    return {
      code: 0,
      msg: 'success',
      data: {
        user_visibility_list: [{
          user_id: OPEN_ID,
          in_white_list: options.visibility === 'visible',
          in_black_list: false,
          in_paid_list: false,
        }],
      },
    };
  });
  const service = new StaleOpportunityReminderSenderEvidenceService(
    options.config ?? config(),
    {
      resolveTenantById: vi.fn(
        async (): Promise<TenantIntegration | null> => selectedIntegration,
      ),
    },
    {
      resolveMemberById: vi.fn(
        async (): Promise<PlatformMember | null> => selectedMember,
      ),
    },
    factory,
  );
  return { service, requestBotInfo, listScopes, checkVisibility };
};

describe('StaleOpportunityReminderSenderEvidenceService', (): void => {
  afterEach((): void => {
    vi.unstubAllEnvs();
  });

  it('registers the sender evidence service in the insight module', (): void => {
    const providers: unknown[] = Reflect.getMetadata(
      MODULE_METADATA.PROVIDERS,
      StaleOpportunityReadinessModule,
    );

    expect(providers).toContain(
      StaleOpportunityReminderSenderEvidenceService,
    );
  });

  it('does not call Feishu when the allowlisted target is incomplete', async (): Promise<void> => {
    const current: Harness = createHarness({
      config: config({ allowedRecipientOpenId: undefined }),
    });

    await expect(current.service.inspect({ now: NOW })).resolves.toMatchObject({
      status: 'not_checked',
      credentialsStatus: 'not_checked',
      warnings: ['stale_opportunity_sender_target_not_configured'],
    });
    expect(current.requestBotInfo).not.toHaveBeenCalled();
    expect(current.listScopes).not.toHaveBeenCalled();
  });

  it('does not call Feishu when the member open id mismatches', async (): Promise<void> => {
    const current: Harness = createHarness({ member: member('ou_other') });

    await expect(current.service.inspect({ now: NOW })).resolves.toMatchObject({
      status: 'unavailable',
      warnings: ['stale_opportunity_sender_target_unavailable'],
    });
    expect(current.requestBotInfo).not.toHaveBeenCalled();
  });

  it('fails closed when credentials are unavailable', async (): Promise<void> => {
    vi.stubEnv('TEST_FEISHU_SECRET', '');
    const factory: FeishuClientFactory = new FeishuClientFactory();
    const service = new StaleOpportunityReminderSenderEvidenceService(
      config(),
      { resolveTenantById: vi.fn(async () => integration()) },
      { resolveMemberById: vi.fn(async () => member()) },
      factory,
    );

    await expect(service.inspect({ now: NOW })).resolves.toMatchObject({
      status: 'unavailable',
      credentialsStatus: 'unavailable',
      warnings: ['stale_opportunity_sender_credentials_unavailable'],
    });
  });

  it.each([
    {
      name: 'bot api failure',
      options: { botCode: 999 },
      warning: 'stale_opportunity_sender_bot_unavailable',
    },
    {
      name: 'disabled bot',
      options: { botEnabled: false },
      warning: 'stale_opportunity_sender_bot_disabled',
    },
    {
      name: 'missing bot open id',
      options: { botOpenId: '' },
      warning: 'stale_opportunity_sender_bot_disabled',
    },
  ] as const)(
    'fails closed for $name',
    async ({ options, warning }): Promise<void> => {
      const current: Harness = createHarness(options);
      const result = await current.service.inspect({ now: NOW });

      expect(result.status).not.toBe('complete');
      expect(result.warnings).toContain(warning);
      if (options.botCode === undefined) {
        expect(result.botStatus).toBe('disabled');
      }
    },
  );

  it('fails closed when no bot send permission is granted', async (): Promise<void> => {
    const current: Harness = createHarness({ scopes: [] });

    await expect(current.service.inspect({ now: NOW })).resolves.toMatchObject({
      status: 'incomplete',
      sendPermissionStatus: 'missing',
      grantedSendScope: null,
      warnings: expect.arrayContaining([
        'stale_opportunity_sender_permission_missing',
      ]),
    });
  });

  it.each([
    'im:message',
    'im:message:send_as_bot',
    'im:message:send',
  ] as StaleOpportunityReminderSenderScope[])(
    'accepts granted send permission %s without sending a message',
    async (scope): Promise<void> => {
      const current: Harness = createHarness({ scopes: [scope] });

      await expect(current.service.inspect({ now: NOW })).resolves.toMatchObject({
        status: 'complete',
        credentialsStatus: 'valid',
        botStatus: 'enabled',
        sendPermissionStatus: 'granted',
        grantedSendScope: scope,
        recipientVisibility: {
          status: 'not_checked',
          inspectionPermissionGranted: false,
        },
        warnings: [
          'stale_opportunity_sender_recipient_visibility_not_checked',
        ],
      });
      expect(current.checkVisibility).not.toHaveBeenCalled();
    },
  );

  it('confirms recipient visibility when inspection permission exists', async (): Promise<void> => {
    const current: Harness = createHarness({
      scopes: [
        'im:message:send_as_bot',
        'application:application:self_manage',
      ],
      visibility: 'visible',
    });

    await expect(current.service.inspect({ now: NOW })).resolves.toMatchObject({
      status: 'complete',
      recipientVisibility: {
        status: 'visible',
        inspectionPermissionGranted: true,
      },
      warnings: [],
    });
    expect(current.checkVisibility).toHaveBeenCalledTimes(1);
  });

  it.each([
    {
      visibility: 'not_visible',
      status: 'not_visible',
      warning: 'stale_opportunity_sender_recipient_not_visible',
    },
    {
      visibility: 'failure',
      status: 'unavailable',
      warning: 'stale_opportunity_sender_recipient_visibility_unavailable',
    },
  ] as const)(
    'fails closed when visibility is $visibility',
    async ({ visibility, status, warning }): Promise<void> => {
      const current: Harness = createHarness({
        scopes: [
          'im:message:send_as_bot',
          'admin:app.info:readonly',
        ],
        visibility,
      });

      await expect(current.service.inspect({ now: NOW })).resolves.toMatchObject({
        status: 'incomplete',
        recipientVisibility: {
          status,
          inspectionPermissionGranted: true,
        },
        warnings: expect.arrayContaining([warning]),
      });
    },
  );
});
