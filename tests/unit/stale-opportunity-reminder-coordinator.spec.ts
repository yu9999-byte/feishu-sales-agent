import { describe, expect, it, vi } from 'vitest';

import type {
  PlatformSessionResponse,
} from '@shared/api.interface';
import type {
  SalesContextTaskResult,
  StaleOpportunityFollowupPage,
  StaleOpportunityFollowupRecord,
  StaleOpportunityPage,
  StaleOpportunityRecord,
  TenantIntegration,
} from '@server/modules/agent-core/agent.types';
import {
  PlatformAccessDeniedError,
} from '@server/modules/platform-shell/platform-session.service';
import {
  StaleOpportunityReminderCoordinatorService,
  type StaleOpportunityReminderControlReader,
  type StaleOpportunityReminderDeliveryPort,
  type StaleOpportunityReminderSessionReader,
} from '@server/modules/insight/stale-opportunity-reminder-coordinator.service';
import type {
  StaleOpportunityEvidence,
} from '@server/modules/insight/stale-opportunity-decision.service';
import type {
  StaleOpportunityReminderDeliveryInput,
  StaleOpportunityReminderDeliveryResult,
} from '@server/modules/insight/stale-opportunity-reminder.service';
import {
  StaleOpportunityScanService,
  type StaleOpportunityRecordsReader,
  type StaleOpportunityTaskReader,
} from '@server/modules/insight/stale-opportunity-scan.service';

const TENANT_ID: string = '10000000-0000-4000-8000-00000000000d';
const MEMBER_ID: string = 'member-sales-a';
const OWNER_OPEN_ID: string = 'ou_sales_a';
const NOW: Date = new Date('2026-09-29T02:00:00.000Z');

const originalEvidence = (): StaleOpportunityEvidence => ({
  opportunityRecordId: 'opportunity-record-1',
  opportunityName: '北辰数字化项目',
  ownerOpenId: OWNER_OPEN_ID,
  followupRecordId: 'followup-record-1',
  lastEffectiveFollowupAt: '2026-09-20T02:00:00.000Z',
  followupVersion: 'followup-version-1',
});

const activeIntegration = (
  status: TenantIntegration['status'] = 'active',
): TenantIntegration => ({
  tenantId: TENANT_ID,
  feishuTenantKey: 'tenant-key-a',
  name: '测试企业',
  status,
  appId: 'cli_test',
  appSecretEnv: 'TEST_APP_SECRET',
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
      primaryField: '跟进记录',
      fields: {
        sourceMessageId: '来源消息',
        customerLink: '关联客户',
        opportunityLink: '关联商机',
        rawText: '原始内容',
        summary: '摘要',
      },
    },
  },
});

const activeSession = (): PlatformSessionResponse => ({
  tenant: {
    id: TENANT_ID,
    name: '测试企业',
    timezone: 'Asia/Shanghai',
  },
  member: {
    id: MEMBER_ID,
    feishuOpenId: OWNER_OPEN_ID,
    displayName: '销售 A',
  },
  roles: ['sales'],
  permissions: ['review:read-personal'],
  navigation: [],
  policyVersion: 'platform-authz-v1',
});

interface CoordinatorHarnessOptions {
  integration?: TenantIntegration | null;
  integrationError?: Error;
  session?: PlatformSessionResponse;
  sessionError?: Error;
  opportunity?: Partial<StaleOpportunityRecord>;
  followup?: Partial<StaleOpportunityFollowupRecord>;
  readOpportunities?: (
    integration: TenantIntegration,
    actorOpenId: string,
    pageToken?: string,
  ) => Promise<StaleOpportunityPage>;
  readFollowups?: (
    integration: TenantIntegration,
    actorOpenId: string,
    pageToken?: string,
  ) => Promise<StaleOpportunityFollowupPage>;
  searchTasks?: (
    integration: TenantIntegration,
    actorOpenId: string,
    query: string,
  ) => Promise<SalesContextTaskResult>;
}

const createHarness = (
  options: CoordinatorHarnessOptions = {},
) => {
  const integration: TenantIntegration | null =
    options.integration === undefined
      ? activeIntegration()
      : options.integration;
  const session: PlatformSessionResponse =
    options.session ?? activeSession();
  const opportunity: StaleOpportunityRecord = {
    recordId: 'opportunity-record-1',
    name: '北辰数字化项目',
    status: 'active',
    ownerOpenId: OWNER_OPEN_ID,
    sourceVersion: 'opportunity-version-1',
    recordUrl: null,
    ...options.opportunity,
  };
  const followup: StaleOpportunityFollowupRecord = {
    recordId: 'followup-record-1',
    opportunityRecordId: opportunity.recordId,
    communicationAt: '2026-09-20T02:00:00.000Z',
    sourceVersion: 'followup-version-1',
    ...options.followup,
  };
  const resolveTenantById = vi.fn(
    async (_tenantId: string): Promise<TenantIntegration | null> => {
      if (options.integrationError) throw options.integrationError;
      return integration;
    },
  );
  const getSessionByMembership = vi.fn(
    async (
      _tenantId: string,
      _memberId: string,
      _occurredAt?: Date,
    ): Promise<PlatformSessionResponse> => {
      if (options.sessionError) throw options.sessionError;
      return session;
    },
  );
  const readStaleOpportunityPage = vi.fn(
    options.readOpportunities ??
    (async (): Promise<StaleOpportunityPage> => ({
      items: [opportunity],
      nextPageToken: null,
    })),
  );
  const readStaleOpportunityFollowupPage = vi.fn(
    options.readFollowups ??
    (async (): Promise<StaleOpportunityFollowupPage> => ({
      items: [followup],
      nextPageToken: null,
    })),
  );
  const searchOwnedTasks = vi.fn(
    options.searchTasks ??
    (async (): Promise<SalesContextTaskResult> => ({ items: [] })),
  );
  const deliver = vi.fn(
    async (
      _input: StaleOpportunityReminderDeliveryInput,
    ): Promise<StaleOpportunityReminderDeliveryResult> => ({
      status: 'sent',
      reason: 'delivered',
      messageId: 'om_fake_reminder',
    }),
  );
  const control: StaleOpportunityReminderControlReader = {
    resolveTenantById,
  };
  const sessions: StaleOpportunityReminderSessionReader = {
    getSessionByMembership,
  };
  const records: StaleOpportunityRecordsReader = {
    readStaleOpportunityPage,
    readStaleOpportunityFollowupPage,
  };
  const tasks: StaleOpportunityTaskReader = { searchOwnedTasks };
  const scanner = new StaleOpportunityScanService(records, tasks);
  const reminders: StaleOpportunityReminderDeliveryPort = { deliver };
  const service = new StaleOpportunityReminderCoordinatorService(
    control,
    sessions,
    scanner,
    reminders,
  );
  return {
    service,
    resolveTenantById,
    getSessionByMembership,
    readStaleOpportunityPage,
    readStaleOpportunityFollowupPage,
    searchOwnedTasks,
    deliver,
  };
};

const run = async (
  service: StaleOpportunityReminderCoordinatorService,
) => service.prepareAndDeliver({
  enabled: true,
  tenantId: TENANT_ID,
  memberId: MEMBER_ID,
  evidence: originalEvidence(),
  now: NOW,
});

describe('StaleOpportunityReminderCoordinatorService', (): void => {
  it('stops before every read and ledger call while disabled', async (): Promise<void> => {
    const harness = createHarness();

    const result = await harness.service.prepareAndDeliver({
      tenantId: TENANT_ID,
      memberId: MEMBER_ID,
      evidence: originalEvidence(),
      now: NOW,
    });

    expect(result).toEqual({ status: 'skipped', reason: 'disabled' });
    expect(harness.resolveTenantById).not.toHaveBeenCalled();
    expect(harness.getSessionByMembership).not.toHaveBeenCalled();
    expect(harness.readStaleOpportunityPage).not.toHaveBeenCalled();
    expect(harness.deliver).not.toHaveBeenCalled();
  });

  it.each([
    ['missing', null],
    ['disabled', activeIntegration('disabled')],
  ])('blocks an %s tenant before session and business reads', async (
    _label: string,
    integration: TenantIntegration | null,
  ): Promise<void> => {
    const harness = createHarness({ integration });

    await expect(run(harness.service)).resolves.toEqual({
      status: 'skipped',
      reason: 'tenant_unavailable',
    });
    expect(harness.getSessionByMembership).not.toHaveBeenCalled();
    expect(harness.readStaleOpportunityPage).not.toHaveBeenCalled();
    expect(harness.deliver).not.toHaveBeenCalled();
  });

  it('blocks a mismatched tenant and a failed tenant read', async (): Promise<void> => {
    for (const options of [
      { integration: { ...activeIntegration(), tenantId: 'other-tenant' } },
      { integrationError: new Error('control store unavailable') },
    ]) {
      const harness = createHarness(options);
      await expect(run(harness.service)).resolves.toMatchObject({
        status: 'skipped',
      });
      expect(harness.getSessionByMembership).not.toHaveBeenCalled();
      expect(harness.deliver).not.toHaveBeenCalled();
    }
  });

  it('blocks an empty role set and an unavailable session', async (): Promise<void> => {
    const session: PlatformSessionResponse = activeSession();
    session.roles = [];
    const withoutRole = createHarness({ session });
    await expect(run(withoutRole.service)).resolves.toEqual({
      status: 'skipped', reason: 'authorization_denied',
    });
    const unavailable = createHarness({
      sessionError: new Error('identity store unavailable'),
    });
    await expect(run(unavailable.service)).resolves.toEqual({
      status: 'skipped', reason: 'source_unverified',
    });
    expect(withoutRole.deliver).not.toHaveBeenCalled();
    expect(unavailable.deliver).not.toHaveBeenCalled();
  });

  it('blocks delivery when the current role was removed', async (): Promise<void> => {
    const harness = createHarness({
      sessionError: new PlatformAccessDeniedError(),
    });

    await expect(run(harness.service)).resolves.toEqual({
      status: 'skipped',
      reason: 'authorization_denied',
    });
    expect(harness.readStaleOpportunityPage).not.toHaveBeenCalled();
    expect(harness.deliver).not.toHaveBeenCalled();
  });

  it('blocks delivery when personal review permission was removed', async (): Promise<void> => {
    const session: PlatformSessionResponse = activeSession();
    session.permissions = [];
    const harness = createHarness({ session });

    await expect(run(harness.service)).resolves.toEqual({
      status: 'skipped',
      reason: 'permission_missing',
    });
    expect(harness.readStaleOpportunityPage).not.toHaveBeenCalled();
    expect(harness.deliver).not.toHaveBeenCalled();
  });

  it.each([
    ['owner', { ownerOpenId: 'ou_new_owner' }],
    ['status', { status: 'won' as const }],
    ['name', { name: '北辰数字化项目（更新）' }],
  ])('does not claim the ledger when the opportunity %s changed', async (
    _label: string,
    opportunity: Partial<StaleOpportunityRecord>,
  ): Promise<void> => {
    const harness = createHarness({ opportunity });

    await expect(run(harness.service)).resolves.toEqual({
      status: 'skipped',
      reason: 'candidate_changed',
    });
    expect(harness.deliver).not.toHaveBeenCalled();
  });

  it('does not claim the ledger after a newer follow-up appears', async (): Promise<void> => {
    const harness = createHarness({
      followup: {
        recordId: 'followup-record-2',
        communicationAt: '2026-09-28T02:00:00.000Z',
        sourceVersion: 'followup-version-2',
      },
    });

    await expect(run(harness.service)).resolves.toEqual({
      status: 'skipped',
      reason: 'candidate_changed',
    });
    expect(harness.deliver).not.toHaveBeenCalled();
  });

  it('does not claim when a follow-up version changes at the same time', async (): Promise<void> => {
    const harness = createHarness({
      followup: { sourceVersion: 'followup-version-2' },
    });
    await expect(run(harness.service)).resolves.toEqual({
      status: 'skipped', reason: 'candidate_changed',
    });
    expect(harness.deliver).not.toHaveBeenCalled();
  });

  it('does not claim the ledger when a relevant task now exists', async (): Promise<void> => {
    const harness = createHarness({
      searchTasks: async (): Promise<SalesContextTaskResult> => ({
        items: [{
          guid: 'task-1',
          title: '跟进北辰数字化项目',
          status: 'todo',
          dueAt: null,
          url: null,
        }],
      }),
    });

    await expect(run(harness.service)).resolves.toEqual({
      status: 'skipped',
      reason: 'candidate_changed',
    });
    expect(harness.deliver).not.toHaveBeenCalled();
  });

  it('fails closed when Base pagination is incomplete', async (): Promise<void> => {
    const harness = createHarness({
      readOpportunities: async (): Promise<StaleOpportunityPage> => ({
        items: [],
        nextPageToken: 'repeated-token',
      }),
    });

    await expect(run(harness.service)).resolves.toEqual({
      status: 'skipped',
      reason: 'source_unverified',
    });
    expect(harness.deliver).not.toHaveBeenCalled();
  });

  it('fails closed when Task pagination is incomplete', async (): Promise<void> => {
    const harness = createHarness({
      searchTasks: async (): Promise<SalesContextTaskResult> => ({
        items: [],
        warning: 'task_pagination_incomplete',
      }),
    });

    await expect(run(harness.service)).resolves.toEqual({
      status: 'skipped',
      reason: 'source_unverified',
    });
    expect(harness.deliver).not.toHaveBeenCalled();
  });

  it('fails closed when a business source throws', async (): Promise<void> => {
    const harness = createHarness({
      readFollowups: async (): Promise<StaleOpportunityFollowupPage> => {
        throw new Error('Base unavailable');
      },
    });
    await expect(run(harness.service)).resolves.toEqual({
      status: 'skipped', reason: 'source_unverified',
    });
    expect(harness.deliver).not.toHaveBeenCalled();
  });

  it('rejects duplicate current candidates for the same record', async (): Promise<void> => {
    const harness = createHarness({
      readOpportunities: async (): Promise<StaleOpportunityPage> => ({
        items: [
          {
            recordId: 'opportunity-record-1', name: '北辰数字化项目',
            status: 'active', ownerOpenId: OWNER_OPEN_ID,
            sourceVersion: 'opportunity-version-1', recordUrl: null,
          },
          {
            recordId: 'opportunity-record-1', name: '北辰数字化项目',
            status: 'active', ownerOpenId: OWNER_OPEN_ID,
            sourceVersion: 'opportunity-version-1', recordUrl: null,
          },
        ],
        nextPageToken: null,
      }),
    });
    await expect(run(harness.service)).resolves.toEqual({
      status: 'skipped', reason: 'candidate_changed',
    });
    expect(harness.deliver).not.toHaveBeenCalled();
  });

  it('passes one exact current candidate to the reminder ledger', async (): Promise<void> => {
    const harness = createHarness();

    await expect(run(harness.service)).resolves.toEqual({
      status: 'sent',
      reason: 'delivered',
      messageId: 'om_fake_reminder',
    });
    expect(harness.deliver).toHaveBeenCalledTimes(1);
    expect(harness.deliver).toHaveBeenCalledWith({
      enabled: true,
      tenantId: TENANT_ID,
      recipientOpenId: OWNER_OPEN_ID,
      evidence: originalEvidence(),
      now: NOW,
    });
  });

  it('does not claim the ledger when the candidate disappeared', async (): Promise<void> => {
    const harness = createHarness({
      readOpportunities: async (): Promise<StaleOpportunityPage> => ({
        items: [],
        nextPageToken: null,
      }),
      readFollowups: async (): Promise<StaleOpportunityFollowupPage> => ({
        items: [],
        nextPageToken: null,
      }),
    });

    await expect(run(harness.service)).resolves.toEqual({
      status: 'skipped',
      reason: 'candidate_changed',
    });
    expect(harness.deliver).not.toHaveBeenCalled();
  });

  it.each([
    ['tenant', { tenant: { ...activeSession().tenant, id: 'other-tenant' } }],
    ['member', { member: { ...activeSession().member, id: 'other-member' } }],
    ['open ID', {
      member: {
        ...activeSession().member,
        feishuOpenId: 'ou_other_member',
      },
    }],
  ])('fails closed for a cross-%s session mismatch', async (
    _label: string,
    override: Partial<PlatformSessionResponse>,
  ): Promise<void> => {
    const session: PlatformSessionResponse = {
      ...activeSession(),
      ...override,
    };
    const harness = createHarness({ session });

    await expect(run(harness.service)).resolves.toEqual({
      status: 'skipped',
      reason: 'source_unverified',
    });
    expect(harness.readStaleOpportunityPage).not.toHaveBeenCalled();
    expect(harness.deliver).not.toHaveBeenCalled();
  });
});
