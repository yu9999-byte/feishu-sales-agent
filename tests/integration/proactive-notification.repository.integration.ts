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

const createUncertainNotification = async (input: {
  tenantId: string;
  memberId: string;
  recipientOpenId: string;
  notificationKey: string;
  now: Date;
}): Promise<void> => {
  const claim = await store.claim({
    tenantId: input.tenantId,
    recipientMemberId: input.memberId,
    recipientOpenId: input.recipientOpenId,
    kind: 'daily_report',
    notificationKey: input.notificationKey,
    subjectKey: input.notificationKey,
    payloadFingerprint: `fingerprint-${input.notificationKey}`,
    now: input.now,
    claimDurationMs: 300_000,
    maxAttempts: 3,
  });
  expect(claim.status).toBe('claimed');
  if (claim.status !== 'claimed') return;
  const state = {
    tenantId: input.tenantId,
    recipientMemberId: input.memberId,
    kind: 'daily_report' as const,
    notificationKey: input.notificationKey,
    claimToken: claim.claimToken,
  };
  await expect(store.markDispatchStarted({
    ...state,
    startedAt: input.now,
  })).resolves.toBe(true);
  await expect(store.markDeliveryUnknown({
    ...state,
    failedAt: new Date(input.now.getTime() + 1_000),
    failureCode: 'PROACTIVE_DELIVERY_UNKNOWN',
    failureMessage: 'Network outcome not verified',
  })).resolves.toBe(true);
};

describe('Postgres proactive notification ledger', (): void => {
  it('freezes first message across failed delivery retries and repository restarts', async () => {
    const message = { tenantId: TENANT_A, recipientMemberId: MEMBER_A, recipientOpenId: 'ou_a',
      kind: 'task_action' as const, notificationKey: 'frozen-payload', subjectKey: 'today',
      title: '首次提醒', subtitle: '原始时间', sections: [], payloadFingerprint: 'first' };
    const input = { ...message, message, now: NOW, claimDurationMs: 60000, maxAttempts: 3 };
    const first = await store.claim(input);
    if (first.status !== 'claimed') throw new Error('Expected claim');
    const state = { tenantId: TENANT_A, recipientMemberId: MEMBER_A, kind: message.kind,
      notificationKey: message.notificationKey, claimToken: first.claimToken };
    await store.markDispatchStarted({ ...state, startedAt: NOW });
    await store.markFailed({ ...state, failedAt: NOW, retryAt: NOW,
      failureCode: 'REJECTED', failureMessage: 'test' });
    const retry = await new PostgresProactiveNotificationStore(sql).claim({ ...input,
      recipientOpenId: 'ou_changed',
      message: { ...message, recipientOpenId: 'ou_changed', subtitle: '重新生成时间' }, payloadFingerprint: 'second',
      now: new Date(NOW.getTime() + 1000) });
    expect(retry.status).toBe('claimed');
    if (retry.status !== 'claimed') throw new Error('Expected retry');
    expect(retry.message).toEqual(message);
    const rows = await sql`SELECT payload_fingerprint,recipient_open_id FROM proactive_sales_notifications
      WHERE tenant_id=${TENANT_A} AND notification_key='frozen-payload'`;
    expect(rows[0].payload_fingerprint).toBe('first');
    expect(rows[0].recipient_open_id).toBe('ou_a');
  });
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

  it('lists uncertain notifications only inside the requested tenant', async (): Promise<void> => {
    await createUncertainNotification({
      tenantId: TENANT_A,
      memberId: MEMBER_A,
      recipientOpenId: 'ou_a',
      notificationKey: 'reconciliation-list-a',
      now: new Date('2026-10-12T02:00:00.000Z'),
    });
    await createUncertainNotification({
      tenantId: TENANT_B,
      memberId: MEMBER_B,
      recipientOpenId: 'ou_b',
      notificationKey: 'reconciliation-list-b',
      now: new Date('2026-10-12T02:00:00.000Z'),
    });

    const records = await store.listUncertain({
      tenantId: TENANT_A,
      limit: 100,
    });
    expect(records).toEqual(expect.arrayContaining([
      expect.objectContaining({
        tenantId: TENANT_A,
        recipientDisplayName: '销售 A',
        notificationKey: 'reconciliation-list-a',
      }),
    ]));
    expect(records).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ notificationKey: 'reconciliation-list-b' }),
    ]));
    expect(records[0]).not.toHaveProperty('recipientOpenId');
  });

  it('keeps uncertain state and audit append atomic under optimistic concurrency', async (): Promise<void> => {
    await createUncertainNotification({
      tenantId: TENANT_A,
      memberId: MEMBER_A,
      recipientOpenId: 'ou_a',
      notificationKey: 'reconciliation-keep',
      now: new Date('2026-10-12T03:00:00.000Z'),
    });
    const record = (await store.listUncertain({
      tenantId: TENANT_A,
      limit: 100,
    })).find((candidate) =>
      candidate.notificationKey === 'reconciliation-keep');
    expect(record).toBeDefined();
    if (!record) return;

    const reconciledAt: Date = new Date('2026-10-12T03:05:00.000Z');
    const input = {
      tenantId: TENANT_A,
      operatorMemberId: MEMBER_A,
      notificationId: record.notificationId,
      expectedUpdatedAt: new Date(record.updatedAt),
      decision: 'keep_frozen' as const,
      note: '证据仍不足，继续冻结等待核查',
      reconciledAt,
    };
    await expect(store.reconcile(input)).resolves.toMatchObject({
      status: 'reconciled',
      previousStatus: 'uncertain',
      currentStatus: 'uncertain',
      updatedAt: reconciledAt,
    });
    await expect(store.reconcile(input)).resolves.toMatchObject({
      status: 'conflict',
      currentStatus: 'uncertain',
      currentUpdatedAt: reconciledAt,
    });

    const [ledger] = await sql`
      SELECT status, updated_at
      FROM proactive_sales_notifications
      WHERE tenant_id = ${TENANT_A}::uuid
        AND id = ${record.notificationId}::uuid
    `;
    const [audit] = await sql`
      SELECT count(*)::integer AS count
      FROM proactive_sales_notification_reconciliations
      WHERE tenant_id = ${TENANT_A}::uuid
        AND notification_id = ${record.notificationId}::uuid
    `;
    expect(ledger.status).toBe('uncertain');
    expect(new Date(ledger.updated_at)).toEqual(reconciledAt);
    expect(audit.count).toBe(1);
  });

  it('releases exactly one additional attempt without sending', async (): Promise<void> => {
    await createUncertainNotification({
      tenantId: TENANT_B,
      memberId: MEMBER_B,
      recipientOpenId: 'ou_b',
      notificationKey: 'reconciliation-retry-once',
      now: new Date('2026-10-12T04:00:00.000Z'),
    });
    const record = (await store.listUncertain({
      tenantId: TENANT_B,
      limit: 100,
    })).find((candidate) =>
      candidate.notificationKey === 'reconciliation-retry-once');
    expect(record).toBeDefined();
    if (!record) return;

    const reconciledAt: Date = new Date('2026-10-12T04:05:00.000Z');
    await expect(store.reconcile({
      tenantId: TENANT_B,
      operatorMemberId: MEMBER_B,
      notificationId: record.notificationId,
      expectedUpdatedAt: new Date(record.updatedAt),
      decision: 'authorize_retry',
      note: '飞书会话中未找到消息，确认未送达',
      reconciledAt,
    })).resolves.toMatchObject({
      status: 'reconciled',
      currentStatus: 'failed',
    });

    const [released] = await sql`
      SELECT status, attempt_count, attempt_limit
      FROM proactive_sales_notifications
      WHERE tenant_id = ${TENANT_B}::uuid
        AND id = ${record.notificationId}::uuid
    `;
    expect(released).toMatchObject({
      status: 'failed',
      attempt_count: 1,
      attempt_limit: 2,
    });

    const retry = await store.claim({
      tenantId: TENANT_B,
      recipientMemberId: MEMBER_B,
      recipientOpenId: 'ou_b',
      kind: 'daily_report',
      notificationKey: 'reconciliation-retry-once',
      subjectKey: 'reconciliation-retry-once',
      payloadFingerprint: 'fingerprint-reconciliation-retry-once',
      now: new Date('2026-10-12T04:06:00.000Z'),
      claimDurationMs: 300_000,
      maxAttempts: 3,
    });
    expect(retry).toMatchObject({ status: 'claimed', attemptCount: 2 });
    if (retry.status !== 'claimed') return;
    const retryState = {
      tenantId: TENANT_B,
      recipientMemberId: MEMBER_B,
      kind: 'daily_report' as const,
      notificationKey: 'reconciliation-retry-once',
      claimToken: retry.claimToken,
    };
    await store.markDispatchStarted({
      ...retryState,
      startedAt: new Date('2026-10-12T04:06:00.000Z'),
    });
    await store.markFailed({
      ...retryState,
      failedAt: new Date('2026-10-12T04:06:01.000Z'),
      retryAt: new Date('2026-10-12T04:07:00.000Z'),
      failureCode: 'PROACTIVE_DELIVERY_FAILED',
      failureMessage: 'Explicit API rejection',
    });
    await expect(store.claim({
      tenantId: TENANT_B,
      recipientMemberId: MEMBER_B,
      recipientOpenId: 'ou_b',
      kind: 'daily_report',
      notificationKey: 'reconciliation-retry-once',
      subjectKey: 'reconciliation-retry-once',
      payloadFingerprint: 'fingerprint-reconciliation-retry-once',
      now: new Date('2026-10-12T04:08:00.000Z'),
      claimDurationMs: 300_000,
      maxAttempts: 3,
    })).resolves.toMatchObject({ status: 'attempts_exhausted' });
  });

  it('records confirm-sent evidence, clears failure state, and blocks delivery', async (): Promise<void> => {
    const notificationKey: string = 'reconciliation-confirm-sent';
    await createUncertainNotification({
      tenantId: TENANT_A,
      memberId: MEMBER_A,
      recipientOpenId: 'ou_a',
      notificationKey,
      now: new Date('2026-10-12T04:30:00.000Z'),
    });
    const record = (await store.listUncertain({
      tenantId: TENANT_A,
      limit: 100,
    })).find((candidate) => candidate.notificationKey === notificationKey);
    expect(record).toBeDefined();
    if (!record) return;

    const sentAt: Date = new Date('2026-10-12T04:30:30.000Z');
    const reconciledAt: Date = new Date('2026-10-12T04:35:00.000Z');
    await expect(store.reconcile({
      tenantId: TENANT_A,
      operatorMemberId: MEMBER_A,
      notificationId: record.notificationId,
      expectedUpdatedAt: new Date(record.updatedAt),
      decision: 'confirm_sent',
      note: '已在飞书会话中核对到对应消息和发送时间',
      messageId: 'om_reconciliation_confirmed',
      sentAt,
      reconciledAt,
    })).resolves.toMatchObject({
      status: 'reconciled',
      previousStatus: 'uncertain',
      currentStatus: 'sent',
      updatedAt: reconciledAt,
    });

    const [ledger] = await sql`
      SELECT
        status,
        message_id,
        sent_at,
        retry_after,
        failure_code,
        failure_message
      FROM proactive_sales_notifications
      WHERE tenant_id = ${TENANT_A}::uuid
        AND id = ${record.notificationId}::uuid
    `;
    expect(ledger).toMatchObject({
      status: 'sent',
      message_id: 'om_reconciliation_confirmed',
      retry_after: null,
      failure_code: null,
      failure_message: null,
    });
    expect(new Date(ledger.sent_at)).toEqual(sentAt);

    const [audit] = await sql`
      SELECT
        decision,
        resulting_status,
        operator_member_id,
        note,
        evidence_message_id,
        evidence_sent_at,
        original_attempt_count,
        original_failure_code,
        original_failure_message
      FROM proactive_sales_notification_reconciliations
      WHERE tenant_id = ${TENANT_A}::uuid
        AND notification_id = ${record.notificationId}::uuid
    `;
    expect(audit).toMatchObject({
      decision: 'confirm_sent',
      resulting_status: 'sent',
      operator_member_id: MEMBER_A,
      note: '已在飞书会话中核对到对应消息和发送时间',
      evidence_message_id: 'om_reconciliation_confirmed',
      original_attempt_count: 1,
      original_failure_code: 'PROACTIVE_DELIVERY_UNKNOWN',
      original_failure_message: 'Network outcome not verified',
    });
    expect(new Date(audit.evidence_sent_at)).toEqual(sentAt);

    await expect(store.claim({
      tenantId: TENANT_A,
      recipientMemberId: MEMBER_A,
      recipientOpenId: 'ou_a',
      kind: 'daily_report',
      notificationKey,
      subjectKey: notificationKey,
      payloadFingerprint: `fingerprint-${notificationKey}`,
      now: new Date('2026-10-12T04:36:00.000Z'),
      claimDurationMs: 300_000,
      maxAttempts: 3,
    })).resolves.toEqual({ status: 'already_sent' });
  });

  it('does not disclose or reconcile another tenant notification', async (): Promise<void> => {
    const notificationKey: string = 'reconciliation-cross-tenant';
    await createUncertainNotification({
      tenantId: TENANT_A,
      memberId: MEMBER_A,
      recipientOpenId: 'ou_a',
      notificationKey,
      now: new Date('2026-10-12T04:45:00.000Z'),
    });
    const record = (await store.listUncertain({
      tenantId: TENANT_A,
      limit: 100,
    })).find((candidate) => candidate.notificationKey === notificationKey);
    expect(record).toBeDefined();
    if (!record) return;

    await expect(store.reconcile({
      tenantId: TENANT_B,
      operatorMemberId: MEMBER_B,
      notificationId: record.notificationId,
      expectedUpdatedAt: new Date(record.updatedAt),
      decision: 'keep_frozen',
      note: '跨租户请求不得读取或写入目标记录',
      reconciledAt: new Date('2026-10-12T05:00:00.000Z'),
    })).resolves.toEqual({ status: 'not_found' });
    const [audit] = await sql`
      SELECT count(*)::integer AS count
      FROM proactive_sales_notification_reconciliations
      WHERE tenant_id = ${TENANT_B}::uuid
        AND notification_id = ${record.notificationId}::uuid
    `;
    expect(audit.count).toBe(0);
  });
});
