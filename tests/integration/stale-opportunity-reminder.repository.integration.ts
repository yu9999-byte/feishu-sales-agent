import { config as loadEnvironment } from 'dotenv';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { Sql } from 'postgres';
import {
  PostgresStaleOpportunityReminderStore,
} from '@server/modules/insight/postgres-stale-opportunity-reminder.store';
import type {
  StaleOpportunityReminderClaimInput,
  StaleOpportunityReminderClaimResult,
} from '@server/modules/insight/stale-opportunity-reminder.service';

loadEnvironment({
  path: ['.env.local', '.env'],
  quiet: true,
});

const TENANT_ID: string = '10000000-0000-4000-8000-00000000000c';
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
