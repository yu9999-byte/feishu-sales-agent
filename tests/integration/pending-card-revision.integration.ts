import { config as loadEnvironment } from 'dotenv';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { Sql } from 'postgres';
import { PostgresControlStore } from
  '@server/modules/control-store/postgres-control.store';

loadEnvironment({
  path: ['.env.local', '.env'],
  quiet: true,
});

const TENANT_ID: string = '10000000-0000-4000-8000-000000000018';
const ORIGINAL_ID: string = '20000000-0000-4000-8000-000000000001';
const REVISION_ID: string = '20000000-0000-4000-8000-000000000002';
const ACTOR_OPEN_ID: string = 'ou_card_revision_integration';
const CARD_MESSAGE_ID: string = 'om_card_revision_integration';
const databaseUrl: string | undefined = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error('DATABASE_URL is required for card revision integration tests');
}

const sql: Sql = postgres(databaseUrl, {
  max: 2,
  connect_timeout: 10,
  idle_timeout: 5,
  onnotice: (): void => undefined,
});

interface ActionRow {
  id: string;
  status: string;
  card_message_id: string | null;
  result_status: string | null;
}

describe('PostgresControlStore pending card revision rollback', (): void => {
  it.each(['executing', 'succeeded', 'cancelled'])('does not expire a %s action when another request cannot acquire it',
    async (status: string): Promise<void> => {
      await sql`UPDATE pending_actions SET status = ${status},
        result = ${JSON.stringify({ status })}::text::jsonb,
        expires_at = '2026-01-01T00:00:00Z'::timestamptz
        WHERE tenant_id = ${TENANT_ID} AND id = ${ORIGINAL_ID}`;
      const store = new PostgresControlStore(sql);
      expect(await store.acquirePendingAction(TENANT_ID, ORIGINAL_ID, ACTOR_OPEN_ID,
        ['pendingConfirmation', 'failed', 'partialFailure'], new Date('2026-10-17T00:00:00Z'))).toBeNull();
      const rows = await sql`SELECT status, result->>'status' AS result_status FROM pending_actions
        WHERE tenant_id = ${TENANT_ID} AND id = ${ORIGINAL_ID}`;
      expect(rows[0]).toMatchObject({ status, result_status: status });
      await sql`UPDATE pending_actions SET status = 'succeeded',
        result = ${JSON.stringify({ status: 'succeeded' })}::text::jsonb,
        expires_at = '2026-12-31T00:00:00Z'::timestamptz
        WHERE tenant_id = ${TENANT_ID} AND id = ${ORIGINAL_ID}`;
    });
  beforeAll(async (): Promise<void> => {
    await sql`
      DELETE FROM agent_tenants
      WHERE id = ${TENANT_ID}::uuid
    `;
    await sql`
      INSERT INTO agent_tenants (id, feishu_tenant_key, name, status)
      VALUES (
        ${TENANT_ID}::uuid,
        'card-revision-integration-tenant',
        '卡片修订回滚测试企业',
        'active'
      )
    `;
    await sql`
      INSERT INTO pending_actions (
        tenant_id,
        id,
        actor_open_id,
        chat_id,
        card_message_id,
        status,
        payload,
        result,
        expires_at
      ) VALUES
        (
          ${TENANT_ID}::uuid,
          ${ORIGINAL_ID}::uuid,
          ${ACTOR_OPEN_ID},
          'oc_card_revision_integration',
          ${CARD_MESSAGE_ID},
          'succeeded',
          '{}'::jsonb,
          ${JSON.stringify({
            pendingActionId: ORIGINAL_ID,
            status: 'succeeded',
          })}::text::jsonb,
          '2026-12-31T00:00:00.000Z'::timestamptz
        ),
        (
          ${TENANT_ID}::uuid,
          ${REVISION_ID}::uuid,
          ${ACTOR_OPEN_ID},
          'oc_card_revision_integration',
          NULL,
          'pendingConfirmation',
          '{}'::jsonb,
          ${JSON.stringify({
            pendingActionId: REVISION_ID,
            status: 'pendingConfirmation',
          })}::text::jsonb,
          '2026-12-31T00:00:00.000Z'::timestamptz
        )
    `;
  });

  afterAll(async (): Promise<void> => {
    await sql`
      DELETE FROM agent_tenants
      WHERE id = ${TENANT_ID}::uuid
    `;
    await sql.end({ timeout: 5 });
  });

  it('atomically restores the card and cancels the invisible revision',
    async (): Promise<void> => {
      const store: PostgresControlStore = new PostgresControlStore(sql);

      await store.movePendingCardMessage(
        TENANT_ID,
        ORIGINAL_ID,
        REVISION_ID,
        ACTOR_OPEN_ID,
      );
      await store.rollbackPendingCardRevision(
        TENANT_ID,
        REVISION_ID,
        ORIGINAL_ID,
        ACTOR_OPEN_ID,
      );

      const rows: ActionRow[] = await sql<ActionRow[]>`
        SELECT
          id,
          status,
          card_message_id,
          result ->> 'status' AS result_status
        FROM pending_actions
        WHERE tenant_id = ${TENANT_ID}::uuid
        ORDER BY id ASC
      `;
      expect(rows).toEqual([
        {
          id: ORIGINAL_ID,
          status: 'succeeded',
          card_message_id: CARD_MESSAGE_ID,
          result_status: 'succeeded',
        },
        {
          id: REVISION_ID,
          status: 'cancelled',
          card_message_id: null,
          result_status: 'cancelled',
        },
      ]);
    });
});

