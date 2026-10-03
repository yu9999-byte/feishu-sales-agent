import { config as loadEnvironment } from 'dotenv';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { Sql } from 'postgres';
import type { TaskEventReceiptInput } from
  '@server/modules/agent-core/agent.types';
import { PostgresControlStore } from
  '@server/modules/control-store/postgres-control.store';

loadEnvironment({
  path: ['.env.local', '.env'],
  quiet: true,
});

const TENANT_A_ID: string = '10000000-0000-4000-8000-000000000016';
const TENANT_B_ID: string = '10000000-0000-4000-8000-000000000017';
const EVENT_ID: string = 'task-receipt-event-1';
const databaseUrl: string | undefined = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error('DATABASE_URL is required for task receipt integration tests');
}

const sql: Sql = postgres(databaseUrl, {
  max: 2,
  connect_timeout: 10,
  idle_timeout: 5,
  onnotice: (): void => undefined,
});

interface ReceiptRow {
  tenant_id: string;
  event_id: string;
  task_guid: string;
  receipt_status: string;
}

const createReceipt = (tenantId: string): TaskEventReceiptInput => ({
  tenantId,
  eventId: EVENT_ID,
  taskGuid: 'task-guid-receipt-1',
  eventTypes: ['task_status_changed'],
  occurredAt: new Date('2026-10-03T02:00:00.000Z'),
  receivedAt: new Date('2026-10-03T02:00:02.000Z'),
  receiptStatus: 'received',
  payloadHash: 'a'.repeat(64),
});

describe('PostgresControlStore task event receipts', (): void => {
  beforeAll(async (): Promise<void> => {
    await sql`
      DELETE FROM agent_tenants
      WHERE id IN (${TENANT_A_ID}::uuid, ${TENANT_B_ID}::uuid)
    `;
    await sql`
      INSERT INTO agent_tenants (id, feishu_tenant_key, name, status)
      VALUES
        (${TENANT_A_ID}::uuid, 'receipt-integration-tenant-a', '任务回执测试企业 A', 'active'),
        (${TENANT_B_ID}::uuid, 'receipt-integration-tenant-b', '任务回执测试企业 B', 'active')
    `;
  });

  afterAll(async (): Promise<void> => {
    await sql`
      DELETE FROM agent_tenants
      WHERE id IN (${TENANT_A_ID}::uuid, ${TENANT_B_ID}::uuid)
    `;
    await sql.end({ timeout: 5 });
  });

  it('deduplicates by tenant and event identifier only', async (): Promise<void> => {
    const store: PostgresControlStore = new PostgresControlStore(sql);

    await expect(store.recordTaskEventReceipt(createReceipt(TENANT_A_ID)))
      .resolves.toBe(true);
    await expect(store.recordTaskEventReceipt(createReceipt(TENANT_A_ID)))
      .resolves.toBe(false);
    await expect(store.recordTaskEventReceipt(createReceipt(TENANT_B_ID)))
      .resolves.toBe(true);

    const rows: ReceiptRow[] = await sql<ReceiptRow[]>`
      SELECT tenant_id, event_id, task_guid, receipt_status
      FROM task_event_receipts
      WHERE event_id = ${EVENT_ID}
      ORDER BY tenant_id ASC
    `;
    expect(rows).toEqual([
      {
        tenant_id: TENANT_A_ID,
        event_id: EVENT_ID,
        task_guid: 'task-guid-receipt-1',
        receipt_status: 'received',
      },
      {
        tenant_id: TENANT_B_ID,
        event_id: EVENT_ID,
        task_guid: 'task-guid-receipt-1',
        receipt_status: 'received',
      },
    ]);
  });
});
