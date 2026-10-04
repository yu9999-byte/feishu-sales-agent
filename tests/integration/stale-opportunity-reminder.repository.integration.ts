import { config as loadEnvironment } from 'dotenv';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import type { Sql } from 'postgres';
import type {
  PlatformSessionResponse,
  StaleOpportunityTriggerResponse,
} from '@shared/api.interface';
import type {
  StaleOpportunityFollowupPage,
  StaleOpportunityPage,
  TenantIntegration,
} from '@server/modules/agent-core/agent.types';
import {
  PostgresStaleOpportunityReminderStore,
} from '@server/modules/insight/postgres-stale-opportunity-reminder.store';
import {
  StaleOpportunityReminderCoordinatorService,
} from '@server/modules/insight/stale-opportunity-reminder-coordinator.service';
import {
  StaleOpportunityReminderExecutionService,
} from '@server/modules/insight/stale-opportunity-reminder-execution.service';
import {
  StaleOpportunityReminderPlanService,
} from '@server/modules/insight/stale-opportunity-reminder-plan.service';
import type {
  StaleOpportunityReminderClaimInput,
  StaleOpportunityReminderClaimResult,
  StaleOpportunityReminderSender,
} from '@server/modules/insight/stale-opportunity-reminder.service';
import {
  StaleOpportunityReminderService,
} from '@server/modules/insight/stale-opportunity-reminder.service';
import {
  StaleOpportunityScanService,
} from '@server/modules/insight/stale-opportunity-scan.service';

loadEnvironment({
  path: ['.env.local', '.env'],
  quiet: true,
});

const TENANT_ID: string = '10000000-0000-4000-8000-00000000000c';
const COORDINATOR_TENANT_ID: string =
  '10000000-0000-4000-8000-00000000000e';
const NOW: Date = new Date('2026-09-29T02:00:00.000Z');
const DAY_MS: number = 24 * 60 * 60 * 1_000;
const databaseUrl: string | undefined = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error('DATABASE_URL is required for reminder integration tests');
}

const sql: Sql = postgres(databaseUrl, {
  max: 4,
  connect_timeout: 10,
  idle_timeout: 5,
  onnotice: (): void => undefined,
});

describe('Stale opportunity preparation with persistent reminder ledger', (): void => {
  beforeAll(async (): Promise<void> => {
    await sql`
      DELETE FROM agent_tenants
      WHERE id = ${COORDINATOR_TENANT_ID}::uuid
    `;
    await sql`
      INSERT INTO agent_tenants (
        id,
        feishu_tenant_key,
        name,
        status
      ) VALUES (
        ${COORDINATOR_TENANT_ID}::uuid,
        'reminder-coordinator-test-tenant',
        '提醒协调集成测试企业',
        'active'
      )
    `;
  });

  afterAll(async (): Promise<void> => {
    await sql`
      DELETE FROM agent_tenants
      WHERE id = ${COORDINATOR_TENANT_ID}::uuid
    `;
  });

  it('plans, rechecks and records only through a fake sender', async (): Promise<void> => {
    const integration: TenantIntegration = {
      tenantId: COORDINATOR_TENANT_ID,
      feishuTenantKey: 'reminder-coordinator-test-tenant',
      name: '提醒协调集成测试企业',
      status: 'active',
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
    };
    const session: PlatformSessionResponse = {
      tenant: {
        id: COORDINATOR_TENANT_ID,
        name: '提醒协调集成测试企业',
        timezone: 'Asia/Shanghai',
      },
      member: {
        id: 'member-sales-a',
        feishuOpenId: 'ou_sales_a',
        displayName: '销售 A',
      },
      roles: ['sales'],
      permissions: ['review:read-personal'],
      navigation: [],
      policyVersion: 'platform-authz-v1',
    };
    const readOpportunities = vi.fn(
      async (): Promise<StaleOpportunityPage> => ({
        items: [{
          recordId: 'coordinator-opportunity-record-1',
          name: '北辰数字化项目',
          status: 'active',
          ownerOpenId: 'ou_sales_a',
          sourceVersion: 'opportunity-version-1',
          recordUrl: null,
        }],
        nextPageToken: null,
      }),
    );
    const readFollowups = vi.fn(
      async (): Promise<StaleOpportunityFollowupPage> => ({
        items: [{
          recordId: 'coordinator-followup-record-1',
          opportunityRecordId: 'coordinator-opportunity-record-1',
          communicationAt: '2026-09-20T02:00:00.000Z',
          sourceVersion: 'coordinator-followup-version-1',
        }],
        nextPageToken: null,
      }),
    );
    const sender: StaleOpportunityReminderSender = {
      send: vi.fn(async () => ({ messageId: 'om_fake_coordinator_1' })),
    };
    const scanner = new StaleOpportunityScanService({
      readStaleOpportunityPage: readOpportunities,
      readStaleOpportunityFollowupPage: readFollowups,
    }, {
      searchOwnedTasks: vi.fn(async () => ({ items: [] })),
    });
    const coordinator = new StaleOpportunityReminderCoordinatorService(
      { resolveTenantById: vi.fn(async () => integration) },
      { getSessionByMembership: vi.fn(async () => session) },
      scanner,
      new StaleOpportunityReminderService(
        new PostgresStaleOpportunityReminderStore(sql),
        sender,
      ),
    );
    const evidence = {
      opportunityRecordId: 'coordinator-opportunity-record-1',
      opportunityName: '北辰数字化项目',
      ownerOpenId: 'ou_sales_a',
      followupRecordId: 'coordinator-followup-record-1',
      lastEffectiveFollowupAt: '2026-09-20T02:00:00.000Z',
      followupVersion: 'coordinator-followup-version-1',
    };
    let plannedVersion: string = evidence.followupVersion;
    const run = vi.fn(async (): Promise<StaleOpportunityTriggerResponse> => ({
      traceId: `trace-${plannedVersion}`,
      generatedAt: NOW.toISOString(),
      mode: 'dry-run',
      status: 'complete',
      summary: {
        tenantCount: 1,
        memberCount: 1,
        scannedMemberCount: 1,
        skippedMemberCount: 0,
        incompleteMemberCount: 0,
        candidateCount: 1,
        suppressedCandidateCount: 0,
        skipCount: 0,
      },
      candidates: [{
        tenantId: COORDINATOR_TENANT_ID,
        memberId: 'member-sales-a',
        ...evidence,
        followupVersion: plannedVersion,
      }],
      skips: [],
      audit: [],
      warnings: [],
    }));
    const planner = new StaleOpportunityReminderPlanService({
      prepare: vi.fn(async () => ({
        status: 'ready' as const,
        checkedAt: NOW.toISOString(),
        reasons: [],
        uncertainDeliveryFound: false,
      })),
    }, { run });
    const execution = new StaleOpportunityReminderExecutionService(
      planner,
      coordinator,
    );

    await expect(execution.execute({ now: NOW })).resolves.toMatchObject({
      status: 'completed',
      summary: {
        plannedCount: 1,
        processedCount: 1,
        sentCount: 1,
        remainingCount: 0,
      },
      outcomes: [{
        result: {
          status: 'sent',
          reason: 'delivered',
          messageId: 'om_fake_coordinator_1',
        },
      }],
    });
    await expect(execution.execute({ now: NOW })).resolves.toMatchObject({
      status: 'completed',
      summary: {
        plannedCount: 1,
        processedCount: 1,
        skippedCount: 1,
      },
      outcomes: [{
        result: {
          status: 'skipped',
          reason: 'cooling_down',
          retryAt: new Date(NOW.getTime() + 7 * DAY_MS).toISOString(),
        },
      }],
    });
    plannedVersion = 'changed-source-version';
    await expect(execution.execute({ now: NOW })).resolves.toMatchObject({
      status: 'completed',
      outcomes: [{
        result: {
          status: 'skipped',
          reason: 'candidate_changed',
        },
      }],
    });
    expect(run).toHaveBeenCalledTimes(3);
    expect(sender.send).toHaveBeenCalledTimes(1);
    expect(readOpportunities).toHaveBeenCalledTimes(3);
    expect(readFollowups).toHaveBeenCalledTimes(3);

    const rows: Array<{ followup_version: string; message_id: string }> =
      await sql`
        SELECT followup_version, message_id
        FROM stale_opportunity_reminders
        WHERE tenant_id = ${COORDINATOR_TENANT_ID}::uuid
          AND opportunity_record_id = 'coordinator-opportunity-record-1'
      `;
    expect(rows).toEqual([{
      followup_version: 'coordinator-followup-version-1',
      message_id: 'om_fake_coordinator_1',
    }]);
  });
});

const claimInput = (
  now: Date,
  followupVersion = 'followup-version-1',
): StaleOpportunityReminderClaimInput => ({
  tenantId: TENANT_ID,
  opportunityRecordId: 'opportunity-record-1',
  opportunityName: '北辰数字化项目',
  ownerOpenId: 'ou_sales_a',
  followupVersion,
  reminderKind: 'stale_followup',
  now,
  claimDurationMs: 5 * 60 * 1_000,
  cooldownMs: 7 * DAY_MS,
});

describe('PostgresStaleOpportunityReminderStore', (): void => {
  beforeAll(async (): Promise<void> => {
    await sql`
      DELETE FROM agent_tenants WHERE id = ${TENANT_ID}::uuid
    `;
    await sql`
      INSERT INTO agent_tenants (
        id,
        feishu_tenant_key,
        name,
        status
      ) VALUES (
        ${TENANT_ID}::uuid,
        'reminder-integration-tenant',
        '提醒集成测试企业',
        'active'
      )
    `;
  });

  afterAll(async (): Promise<void> => {
    await sql`
      DELETE FROM agent_tenants WHERE id = ${TENANT_ID}::uuid
    `;
    await sql.end({ timeout: 5 });
  });

  it('claims concurrently once, cools down, retries and resets for a new version', async (): Promise<void> => {
    const store = new PostgresStaleOpportunityReminderStore(sql);
    const concurrent: StaleOpportunityReminderClaimResult[] =
      await Promise.all([
        store.claim(claimInput(NOW)),
        store.claim(claimInput(NOW)),
      ]);
    const claimed = concurrent.find(
      (result: StaleOpportunityReminderClaimResult): boolean =>
        result.status === 'claimed',
    );
    const inFlight = concurrent.find(
      (result: StaleOpportunityReminderClaimResult): boolean =>
        result.status === 'in_flight',
    );
    expect(claimed?.status).toBe('claimed');
    expect(inFlight?.status).toBe('in_flight');
    if (!claimed || claimed.status !== 'claimed') {
      throw new Error('Expected one claimed reminder');
    }

    await expect(store.markDispatchStarted({
      tenantId: TENANT_ID,
      opportunityRecordId: 'opportunity-record-1',
      followupVersion: 'followup-version-1',
      reminderKind: 'stale_followup',
      claimToken: claimed.claimToken,
      startedAt: NOW,
    })).resolves.toBe(true);
    await expect(store.markSent({
      tenantId: TENANT_ID,
      opportunityRecordId: 'opportunity-record-1',
      followupVersion: 'followup-version-1',
      reminderKind: 'stale_followup',
      claimToken: claimed.claimToken,
      messageId: 'om_reminder_1',
      sentAt: NOW,
    })).resolves.toBe(true);

    await expect(store.claim(claimInput(
      new Date(NOW.getTime() + DAY_MS),
    ))).resolves.toEqual({
      status: 'cooling_down',
      retryAt: new Date(NOW.getTime() + 7 * DAY_MS),
    });

    const cooled: StaleOpportunityReminderClaimResult = await store.claim(
      claimInput(new Date(NOW.getTime() + 8 * DAY_MS)),
    );
    expect(cooled).toMatchObject({ status: 'claimed', attemptCount: 2 });
    if (cooled.status !== 'claimed') {
      throw new Error('Expected a claim after cooldown');
    }
    await expect(store.markDispatchStarted({
      tenantId: TENANT_ID,
      opportunityRecordId: 'opportunity-record-1',
      followupVersion: 'followup-version-1',
      reminderKind: 'stale_followup',
      claimToken: cooled.claimToken,
      startedAt: new Date(NOW.getTime() + 8 * DAY_MS),
    })).resolves.toBe(true);
    await expect(store.markSent({
      tenantId: TENANT_ID,
      opportunityRecordId: 'opportunity-record-1',
      followupVersion: 'followup-version-1',
      reminderKind: 'stale_followup',
      claimToken: claimed.claimToken,
      messageId: 'om_stale_worker',
      sentAt: new Date(NOW.getTime() + 8 * DAY_MS),
    })).resolves.toBe(false);

    const failedAt: Date = new Date(NOW.getTime() + 8 * DAY_MS);
    const retryAt: Date = new Date(failedAt.getTime() + 15 * 60 * 1_000);
    await expect(store.markFailed({
      tenantId: TENANT_ID,
      opportunityRecordId: 'opportunity-record-1',
      followupVersion: 'followup-version-1',
      reminderKind: 'stale_followup',
      claimToken: cooled.claimToken,
      failedAt,
      retryAt,
      failureCode: 'TEST_FAILURE',
      failureMessage: '受控集成测试失败',
    })).resolves.toBe(true);
    await expect(store.claim(claimInput(failedAt))).resolves.toEqual({
      status: 'retry_scheduled',
      retryAt,
    });
    await expect(store.claim(claimInput(retryAt))).resolves.toMatchObject({
      status: 'claimed',
      attemptCount: 3,
    });

    await expect(store.claim(claimInput(
      NOW,
      'followup-version-2',
    ))).resolves.toMatchObject({
      status: 'claimed',
      attemptCount: 1,
    });
  });

  it('blocks uncertain delivery after a dispatch lease expires', async (): Promise<void> => {
    const store = new PostgresStaleOpportunityReminderStore(sql);
    const first: StaleOpportunityReminderClaimInput = {
      ...claimInput(NOW),
      opportunityRecordId: 'opportunity-record-uncertain',
    };
    const claim: StaleOpportunityReminderClaimResult =
      await store.claim(first);
    expect(claim.status).toBe('claimed');
    if (claim.status !== 'claimed') {
      throw new Error('Expected a claim before dispatch');
    }
    await expect(store.markDispatchStarted({
      tenantId: first.tenantId,
      opportunityRecordId: first.opportunityRecordId,
      followupVersion: first.followupVersion,
      reminderKind: first.reminderKind,
      claimToken: claim.claimToken,
      startedAt: NOW,
    })).resolves.toBe(true);

    const afterLease: Date = new Date(NOW.getTime() + DAY_MS);
    await expect(store.claim({ ...first, now: afterLease }))
      .resolves.toEqual({ status: 'delivery_unknown' });
    await expect(store.markDeliveryUnknown({
      tenantId: first.tenantId,
      opportunityRecordId: first.opportunityRecordId,
      followupVersion: first.followupVersion,
      reminderKind: first.reminderKind,
      claimToken: claim.claimToken,
      failedAt: afterLease,
      failureCode: 'TEST_UNKNOWN',
      failureMessage: 'Network outcome not verified',
    })).resolves.toBe(true);
    await expect(store.listUncertain({
      tenantId: first.tenantId,
      limit: 10,
    })).resolves.toEqual([{
      tenantId: first.tenantId,
      opportunityRecordId: first.opportunityRecordId,
      followupVersion: first.followupVersion,
      reminderKind: 'stale_followup',
      opportunityName: first.opportunityName,
      ownerOpenId: first.ownerOpenId,
      attemptCount: 1,
      dispatchStartedAt: NOW.toISOString(),
      failureCode: 'TEST_UNKNOWN',
      failureMessage: 'Network outcome not verified',
      updatedAt: afterLease.toISOString(),
    }]);
    await expect(store.claim({ ...first, now: afterLease }))
      .resolves.toEqual({ status: 'delivery_unknown' });
  });

  it('reclaims an expired pre-dispatch lease without sending', async (): Promise<void> => {
    const store = new PostgresStaleOpportunityReminderStore(sql);
    const first: StaleOpportunityReminderClaimInput = {
      ...claimInput(NOW),
      opportunityRecordId: 'opportunity-record-pre-dispatch',
    };
    const claimed: StaleOpportunityReminderClaimResult =
      await store.claim(first);
    expect(claimed.status).toBe('claimed');
    const reclaimed: StaleOpportunityReminderClaimResult = await store.claim({
      ...first,
      now: new Date(NOW.getTime() + 6 * 60 * 1_000),
    });
    expect(reclaimed).toMatchObject({
      status: 'claimed',
      attemptCount: 2,
    });
    if (claimed.status !== 'claimed' || reclaimed.status !== 'claimed') {
      throw new Error('Expected an expired lease to be reclaimed');
    }
    await expect(store.markDispatchStarted({
      tenantId: first.tenantId,
      opportunityRecordId: first.opportunityRecordId,
      followupVersion: first.followupVersion,
      reminderKind: first.reminderKind,
      claimToken: claimed.claimToken,
      startedAt: NOW,
    })).resolves.toBe(false);
  });
});
