import { config as loadEnvironment } from 'dotenv';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { Sql } from 'postgres';
import { PostgresProactiveNotificationStore } from
  '@server/modules/insight/postgres-proactive-notification.store';

loadEnvironment({ path: ['.env.local', '.env'], quiet: true });

const TENANT_A: string = '10000000-0000-4000-8000-000000000021';
const TENANT_B: string = '10000000-0000-4000-8000-000000000022';
const MEMBER_A: string = '20000000-0000-4000-8000-000000000021';
const MEMBER_B: string = '20000000-0000-4000-8000-000000000022';
const NOW: Date = new Date('2026-10-12T01:05:00.000Z');
const databaseUrl: string | undefined = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error('DATABASE_URL is required for proactive integration tests');
}

const sql: Sql = postgres(databaseUrl, {
  max: 4,
  connect_timeout: 10,
  idle_timeout: 5,
  onnotice: (): void => undefined,
});
const store: PostgresProactiveNotificationStore =
  new PostgresProactiveNotificationStore(sql);

describe('Postgres proactive notification ledger', (): void => {
  beforeAll(async (): Promise<void> => {
    await sql`DELETE FROM agent_tenants WHERE id IN (
      ${TENANT_A}::uuid, ${TENANT_B}::uuid
    )`;
    await sql`
      INSERT INTO agent_tenants (id, feishu_tenant_key, name, status)
      VALUES
        (${TENANT_A}::uuid, 'proactive-test-a', '主动通知测试 A', 'active'),
        (${TENANT_B}::uuid, 'proactive-test-b', '主动通知测试 B', 'active')
    `;
    await sql`
      INSERT INTO tenant_members (
        tenant_id, id, feishu_open_id, display_name, status
      ) VALUES
        (${TENANT_A}::uuid, ${MEMBER_A}::uuid, 'ou_a', '销售 A', 'active'),
        (${TENANT_B}::uuid, ${MEMBER_B}::uuid, 'ou_b', '销售 B', 'active')
    `;
  });

  afterAll(async (): Promise<void> => {
    await sql`DELETE FROM agent_tenants WHERE id IN (
      ${TENANT_A}::uuid, ${TENANT_B}::uuid
    )`;
    await sql.end({ timeout: 5 });
  });

  it('allows only one concurrent claim for the same occurrence', async (): Promise<void> => {
    const input = {
      tenantId: TENANT_A,
      recipientMemberId: MEMBER_A,
      recipientOpenId: 'ou_a',
      kind: 'task_action' as const,
      notificationKey: '2026-10-12',
      subjectKey: 'task-digest',
      payloadFingerprint: 'fingerprint-a',
      now: NOW,
      claimDurationMs: 300_000,
      maxAttempts: 3,
    };
    const results = await Promise.all([store.claim(input), store.claim(input)]);
    expect(results.filter((result) => result.status === 'claimed')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'in_flight')).toHaveLength(1);
  });

  it('records sent state and prevents duplicate delivery', async (): Promise<void> => {
    const claim = await store.claim({
      tenantId: TENANT_B,
      recipientMemberId: MEMBER_B,
      recipientOpenId: 'ou_b',
      kind: 'daily_report',
      notificationKey: '2026-10-12',
      subjectKey: '2026-10-12',
      payloadFingerprint: 'fingerprint-b',
      now: NOW,
      claimDurationMs: 300_000,
      maxAttempts: 3,
    });
    expect(claim.status).toBe('claimed');
    if (claim.status !== 'claimed') return;
    const state = {
      tenantId: TENANT_B,
      recipientMemberId: MEMBER_B,
      kind: 'daily_report' as const,
      notificationKey: '2026-10-12',
      claimToken: claim.claimToken,
    };
    await expect(store.markDispatchStarted({
      ...state,
      startedAt: NOW,
    })).resolves.toBe(true);
    await expect(store.markSent({
      ...state,
      messageId: 'om_proactive_test',
      sentAt: NOW,
    })).resolves.toBe(true);
    await expect(store.claim({
      tenantId: TENANT_B,
      recipientMemberId: MEMBER_B,
      recipientOpenId: 'ou_b',
      kind: 'daily_report',
      notificationKey: '2026-10-12',
      subjectKey: '2026-10-12',
      payloadFingerprint: 'fingerprint-b',
      now: new Date('2026-10-12T01:10:00.000Z'),
      claimDurationMs: 300_000,
      maxAttempts: 3,
    })).resolves.toEqual({ status: 'already_sent' });
  });

  it('isolates risk observation state by tenant and member', async (): Promise<void> => {
    await store.saveRiskState({
      tenantId: TENANT_A,
      recipientMemberId: MEMBER_A,
      opportunityRecordId: 'opp-shared',
      severityRank: 2,
      payloadFingerprint: 'risk-a',
      observedAt: NOW,
    });
    await expect(store.getRiskState({
      tenantId: TENANT_A,
      recipientMemberId: MEMBER_A,
      opportunityRecordId: 'opp-shared',
    })).resolves.toEqual(expect.objectContaining({
      severityRank: 2,
      payloadFingerprint: 'risk-a',
    }));
    await expect(store.getRiskState({
      tenantId: TENANT_B,
      recipientMemberId: MEMBER_B,
      opportunityRecordId: 'opp-shared',
    })).resolves.toBeNull();
  });
});
