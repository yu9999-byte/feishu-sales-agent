import {
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { MODULE_METADATA } from '@nestjs/common/constants';
import { describe, expect, it, vi } from 'vitest';

import type {
  PlatformPermission,
  PlatformSessionResponse,
  StaleOpportunityTriggerResponse,
} from '@shared/api.interface';
import type { AgentRuntimeConfig } from '@server/config/agent.config';
import type {
  StaleOpportunityFollowupPage,
  StaleOpportunityPage,
  TenantIntegration,
} from '@server/modules/agent-core/agent.types';
import type {
  PlatformMember,
} from '@server/modules/identity-access/identity-access.types';
import {
  StaleOpportunityReadinessModule,
} from '@server/modules/insight/stale-opportunity-readiness.module';
import {
  StaleOpportunityTriggerController,
  type StaleOpportunityTriggerRunner,
} from '@server/modules/insight/stale-opportunity-trigger.controller';
import {
  StaleOpportunityTriggerService,
  type StaleOpportunityTriggerControlReader,
  type StaleOpportunityTriggerIdentityReader,
  type StaleOpportunityTriggerSessionReader,
} from '@server/modules/insight/stale-opportunity-trigger.service';
import type {
  StaleOpportunityRecordsReader,
  StaleOpportunityTaskReader,
} from '@server/modules/insight/stale-opportunity-scan.service';
import {
  PlatformAccessDeniedError,
} from '@server/modules/platform-shell/platform-session.service';

const TENANT_A: string = '00000000-0000-4000-8000-00000000000a';
const TENANT_B: string = '00000000-0000-4000-8000-00000000000b';
const NOW: Date = new Date('2026-10-02T02:00:00.000Z');
const TRACE_ID: string = 'trace-stale-opportunity-dry-run';

const runtimeConfig = (
  enabled?: boolean,
  token?: string,
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
  ...(enabled === undefined
    ? {}
    : {
        staleOpportunityScan: {
          enabled,
          triggerToken: token,
        },
      }),
});

const integration = (
  tenantId: string = TENANT_A,
): TenantIntegration => ({
  tenantId,
  feishuTenantKey: `tenant-key-${tenantId}`,
  name: `Tenant ${tenantId}`,
  status: 'active',
  appId: `cli-${tenantId}`,
  appSecretEnv: 'TEST_SECRET',
  appType: 'selfBuild',
  base: {
    appToken: `base-${tenantId}`,
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
        sourceMessageId: '来源消息ID',
        customerLink: '关联客户',
        opportunityLink: '关联商机',
        rawText: '跟进原文',
        summary: '跟进摘要',
        ownerOpenId: '负责人',
        communicationAt: '本次沟通发生时间',
      },
    },
  },
});

const member = (
  id: string,
  feishuOpenId: string,
  tenantId: string = TENANT_A,
  status: PlatformMember['status'] = 'active',
): PlatformMember => ({
  id,
  tenantId,
  feishuOpenId,
  displayName: id,
  status,
});

const session = (
  selectedMember: PlatformMember,
  permissions: PlatformPermission[] = ['review:read-personal'],
): PlatformSessionResponse => ({
  tenant: {
    id: selectedMember.tenantId,
    name: selectedMember.tenantId,
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
});

interface HarnessOptions {
  config?: AgentRuntimeConfig;
  integrations?: TenantIntegration[];
  members?: PlatformMember[];
  resolveIntegration?: (
    tenantId: string,
  ) => Promise<TenantIntegration | null>;
  listMembers?: (tenantId: string) => Promise<PlatformMember[]>;
  getSession?: (
    tenantId: string,
    memberId: string,
    occurredAt?: Date,
  ) => Promise<PlatformSessionResponse>;
  readOpportunities?: (
    integration: TenantIntegration,
    actorOpenId: string,
  ) => Promise<StaleOpportunityPage>;
}

interface TriggerHarness {
  service: StaleOpportunityTriggerService;
  listActiveIntegrations: ReturnType<typeof vi.fn>;
  resolveTenantById: ReturnType<typeof vi.fn>;
  listMembers: ReturnType<typeof vi.fn>;
  getSessionByMembership: ReturnType<typeof vi.fn>;
  readStaleOpportunityPage: ReturnType<typeof vi.fn>;
  readStaleOpportunityFollowupPage: ReturnType<typeof vi.fn>;
  searchOwnedTasks: ReturnType<typeof vi.fn>;
}

const createHarness = (
  options: HarnessOptions = {},
): TriggerHarness => {
  const integrations: TenantIntegration[] = options.integrations ?? [
    integration(),
  ];
  const members: PlatformMember[] = options.members ?? [
    member('member-a', 'ou-sales-a'),
  ];
  const listActiveIntegrations = vi.fn(
    async (): Promise<TenantIntegration[]> => structuredClone(integrations),
  );
  const resolveTenantById = vi.fn(
    options.resolveIntegration ??
    (async (tenantId: string): Promise<TenantIntegration | null> => {
      const found: TenantIntegration | undefined = integrations.find(
        (item: TenantIntegration): boolean => item.tenantId === tenantId,
      );
      return found ? structuredClone(found) : null;
    }),
  );
  const listMembers = vi.fn(
    options.listMembers ??
    (async (tenantId: string): Promise<PlatformMember[]> =>
      structuredClone(members.filter(
        (item: PlatformMember): boolean => item.tenantId === tenantId,
      ))),
  );
  const getSessionByMembership = vi.fn(
    options.getSession ??
    (async (
      tenantId: string,
      memberId: string,
    ): Promise<PlatformSessionResponse> => {
      const found: PlatformMember | undefined = members.find(
        (item: PlatformMember): boolean =>
          item.tenantId === tenantId && item.id === memberId,
      );
      if (!found || found.status !== 'active') {
        throw new PlatformAccessDeniedError();
      }
      return session(found);
    }),
  );
  const readStaleOpportunityPage = vi.fn(
    options.readOpportunities ??
    (async (
      selectedIntegration: TenantIntegration,
      actorOpenId: string,
    ): Promise<StaleOpportunityPage> => ({
      items: [{
        recordId: `opportunity-${selectedIntegration.tenantId}-${actorOpenId}`,
        name: `商机-${selectedIntegration.tenantId}-${actorOpenId}`,
        status: 'active',
        ownerOpenId: actorOpenId,
        sourceVersion: 'opportunity-version-1',
        recordUrl: null,
      }],
      nextPageToken: null,
    })),
  );
  const readStaleOpportunityFollowupPage = vi.fn(
    async (
      selectedIntegration: TenantIntegration,
      actorOpenId: string,
    ): Promise<StaleOpportunityFollowupPage> => ({
      items: [{
        recordId: `followup-${selectedIntegration.tenantId}-${actorOpenId}`,
        opportunityRecordId:
          `opportunity-${selectedIntegration.tenantId}-${actorOpenId}`,
        communicationAt: '2026-09-20T02:00:00.000Z',
        sourceVersion: 'followup-version-1',
      }],
      nextPageToken: null,
    }),
  );
  const searchOwnedTasks = vi.fn(async (): Promise<{ items: [] }> => ({
    items: [],
  }));
  const control: StaleOpportunityTriggerControlReader = {
    listActiveIntegrations,
    resolveTenantById,
  };
  const identity: StaleOpportunityTriggerIdentityReader = { listMembers };
  const sessions: StaleOpportunityTriggerSessionReader = {
    getSessionByMembership,
  };
  const records: StaleOpportunityRecordsReader = {
    readStaleOpportunityPage,
    readStaleOpportunityFollowupPage,
  };
  const tasks: StaleOpportunityTaskReader = { searchOwnedTasks };
  const service: StaleOpportunityTriggerService =
    new StaleOpportunityTriggerService(
      options.config ?? runtimeConfig(true, 'configured-token'),
      control,
      identity,
      sessions,
      records,
      tasks,
    );
  return {
    service,
    listActiveIntegrations,
    resolveTenantById,
    listMembers,
    getSessionByMembership,
    readStaleOpportunityPage,
    readStaleOpportunityFollowupPage,
    searchOwnedTasks,
  };
};

const disabledResponse = (): StaleOpportunityTriggerResponse => ({
  traceId: TRACE_ID,
  generatedAt: NOW.toISOString(),
  mode: 'dry-run',
  status: 'disabled',
  summary: {
    tenantCount: 0,
    memberCount: 0,
    scannedMemberCount: 0,
    skippedMemberCount: 0,
    incompleteMemberCount: 0,
    candidateCount: 0,
    suppressedCandidateCount: 0,
    skipCount: 1,
  },
  candidates: [],
  skips: [{
    tenantId: null,
    memberId: null,
    opportunityRecordId: null,
    opportunityName: null,
    reason: 'disabled',
  }],
  audit: [{
    scope: 'batch',
    tenantId: null,
    memberId: null,
    outcome: 'skipped',
    code: 'disabled',
    candidateCount: 0,
    skipCount: 1,
  }],
  warnings: [],
});

describe('StaleOpportunityTriggerService', (): void => {
  it('stays disabled without configuration and performs no reads', async (): Promise<void> => {
    const harness: TriggerHarness = createHarness({
      config: runtimeConfig(),
    });

    const result: StaleOpportunityTriggerResponse =
      await harness.service.run({ now: NOW, traceId: TRACE_ID });

    expect(result).toEqual(disabledResponse());
    expect(harness.listActiveIntegrations).not.toHaveBeenCalled();
    expect(harness.listMembers).not.toHaveBeenCalled();
    expect(harness.readStaleOpportunityPage).not.toHaveBeenCalled();
    expect(harness.searchOwnedTasks).not.toHaveBeenCalled();
  });

  it('enumerates active members while skipping disabled and unauthorized members', async (): Promise<void> => {
    const members: PlatformMember[] = [
      member('member-a', 'ou-sales-a'),
      member('member-b', 'ou-disabled', TENANT_A, 'disabled'),
      member('member-c', 'ou-roleless'),
      member('member-d', 'ou-no-permission'),
    ];
    const harness: TriggerHarness = createHarness({
      members,
      getSession: async (
        _tenantId: string,
        memberId: string,
      ): Promise<PlatformSessionResponse> => {
        const selected: PlatformMember | undefined = members.find(
          (item: PlatformMember): boolean => item.id === memberId,
        );
        if (!selected || memberId === 'member-c') {
          throw new PlatformAccessDeniedError();
        }
        return session(
          selected,
          memberId === 'member-d' ? [] : ['review:read-personal'],
        );
      },
    });

    const result: StaleOpportunityTriggerResponse =
      await harness.service.run({ now: NOW, traceId: TRACE_ID });

    expect(result.status).toBe('complete');
    expect(result.summary).toMatchObject({
      tenantCount: 1,
      memberCount: 4,
      scannedMemberCount: 1,
      skippedMemberCount: 3,
      candidateCount: 1,
    });
    expect(result.skips.map((item) => item.reason)).toEqual([
      'member_inactive',
      'authorization_denied',
      'permission_missing',
    ]);
    expect(harness.getSessionByMembership).toHaveBeenCalledTimes(3);
    expect(harness.readStaleOpportunityPage).toHaveBeenCalledTimes(1);
    expect(harness.searchOwnedTasks).toHaveBeenCalledTimes(1);
  });

  it('clears otherwise valid candidates when one member scan is incomplete', async (): Promise<void> => {
    const harness: TriggerHarness = createHarness({
      members: [
        member('member-a', 'ou-good'),
        member('member-b', 'ou-broken'),
      ],
      readOpportunities: async (
        selectedIntegration: TenantIntegration,
        actorOpenId: string,
      ): Promise<StaleOpportunityPage> => {
        if (actorOpenId === 'ou-broken') {
          throw new Error('source unavailable');
        }
        return {
          items: [{
            recordId:
              `opportunity-${selectedIntegration.tenantId}-${actorOpenId}`,
            name: '可识别的停滞商机',
            status: 'active',
            ownerOpenId: actorOpenId,
            sourceVersion: 'opportunity-version-1',
            recordUrl: null,
          }],
          nextPageToken: null,
        };
      },
    });

    const result: StaleOpportunityTriggerResponse =
      await harness.service.run({ now: NOW, traceId: TRACE_ID });

    expect(result.status).toBe('incomplete');
    expect(result.candidates).toEqual([]);
    expect(result.summary).toMatchObject({
      scannedMemberCount: 2,
      incompleteMemberCount: 1,
      candidateCount: 0,
      suppressedCandidateCount: 1,
    });
    expect(result.audit).toContainEqual(expect.objectContaining({
      scope: 'batch',
      outcome: 'suppressed',
      code: 'batch_incomplete',
      candidateCount: 1,
    }));
    expect(result.warnings).toContain('stale_opportunity_batch_incomplete');
  });

  it('preserves tenant and member boundaries across a batch', async (): Promise<void> => {
    const integrations: TenantIntegration[] = [
      integration(TENANT_B),
      integration(TENANT_A),
    ];
    const members: PlatformMember[] = [
      member('member-a', 'ou-sales-a', TENANT_A),
      member('member-b', 'ou-sales-b', TENANT_B),
    ];
    const harness: TriggerHarness = createHarness({ integrations, members });

    const result: StaleOpportunityTriggerResponse =
      await harness.service.run({ now: NOW, traceId: TRACE_ID });

    expect(result.status).toBe('complete');
    expect(result.candidates.map((item) => ({
      tenantId: item.tenantId,
      memberId: item.memberId,
    }))).toEqual([
      { tenantId: TENANT_A, memberId: 'member-a' },
      { tenantId: TENANT_B, memberId: 'member-b' },
    ]);
    expect(harness.listMembers.mock.calls.map((call) => call[0])).toEqual([
      TENANT_A,
      TENANT_B,
    ]);
    expect(harness.readStaleOpportunityPage.mock.calls.map((call) => [
      call[0].tenantId,
      call[1],
    ])).toEqual([
      [TENANT_A, 'ou-sales-a'],
      [TENANT_B, 'ou-sales-b'],
    ]);
  });

  it('is deterministic and read-only for a duplicate dry-run invocation', async (): Promise<void> => {
    const harness: TriggerHarness = createHarness();

    const first: StaleOpportunityTriggerResponse =
      await harness.service.run({ now: NOW, traceId: TRACE_ID });
    const second: StaleOpportunityTriggerResponse =
      await harness.service.run({ now: NOW, traceId: TRACE_ID });

    expect(second).toEqual(first);
    expect(harness.listActiveIntegrations).toHaveBeenCalledTimes(2);
    expect(harness.readStaleOpportunityPage).toHaveBeenCalledTimes(2);
    expect(harness.readStaleOpportunityFollowupPage).toHaveBeenCalledTimes(2);
    expect(harness.searchOwnedTasks).toHaveBeenCalledTimes(2);
  });
});

describe('StaleOpportunityTriggerController', (): void => {
  it('rejects missing trigger configuration before running the batch', async (): Promise<void> => {
    const run = vi.fn(async (): Promise<StaleOpportunityTriggerResponse> =>
      disabledResponse());
    const runner: StaleOpportunityTriggerRunner = { run };
    const controller = new StaleOpportunityTriggerController(
      runtimeConfig(false),
      runner,
    );

    await expect(controller.run('Bearer supplied-token')).rejects
      .toBeInstanceOf(ServiceUnavailableException);
    expect(run).not.toHaveBeenCalled();
  });

  it('rejects a missing or invalid bearer token before any batch read', async (): Promise<void> => {
    const run = vi.fn(async (): Promise<StaleOpportunityTriggerResponse> =>
      disabledResponse());
    const runner: StaleOpportunityTriggerRunner = { run };
    const controller = new StaleOpportunityTriggerController(
      runtimeConfig(true, 'correct-trigger-token'),
      runner,
    );

    await expect(controller.run()).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    await expect(controller.run('Bearer wrong-trigger-token')).rejects
      .toBeInstanceOf(UnauthorizedException);
    expect(run).not.toHaveBeenCalled();
  });

  it('runs the dry batch once for a valid dedicated token', async (): Promise<void> => {
    const response: StaleOpportunityTriggerResponse = disabledResponse();
    const run = vi.fn(async (): Promise<StaleOpportunityTriggerResponse> =>
      response);
    const runner: StaleOpportunityTriggerRunner = { run };
    const controller = new StaleOpportunityTriggerController(
      runtimeConfig(true, 'correct-trigger-token'),
      runner,
    );

    await expect(controller.run('Bearer correct-trigger-token')).resolves
      .toEqual(response);
    expect(run).toHaveBeenCalledTimes(1);
  });
});

describe('StaleOpportunityReadinessModule trigger wiring', (): void => {
  it('registers the internal controller and trigger service', (): void => {
    const controllers: unknown = Reflect.getMetadata(
      MODULE_METADATA.CONTROLLERS,
      StaleOpportunityReadinessModule,
    );
    const providers: unknown = Reflect.getMetadata(
      MODULE_METADATA.PROVIDERS,
      StaleOpportunityReadinessModule,
    );

    expect(controllers).toEqual(expect.arrayContaining([
      StaleOpportunityTriggerController,
    ]));
    expect(providers).toEqual(expect.arrayContaining([
      StaleOpportunityTriggerService,
    ]));
  });
});
