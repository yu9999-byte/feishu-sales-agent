import { createHash, randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import type { Sql } from 'postgres';
import type { TodayActionOperationRequest, TodayActionState } from '@shared/api.interface';
import { AGENT_DATABASE } from '@server/modules/control-store/postgres-control.store';
import type { TodayActionOperationScope, TodayActionStateStore } from './today-action-state.store';
import { transitionTodayAction } from './today-action-state';

interface StateRow {
  item_id: string;
  item_version: string;
  revision: number;
  status: TodayActionState['status'];
  remind_at: Date | string | null;
}
const stateFromRow = (row: StateRow): TodayActionState => ({
  itemId: row.item_id, itemVersion: row.item_version, revision: row.revision,
  status: row.status, remindAt: row.remind_at === null ? null : new Date(row.remind_at).toISOString(),
});

@Injectable()
class PostgresTodayActionStateStore implements TodayActionStateStore {
  constructor(@Inject(AGENT_DATABASE) private readonly sql: Sql) {}

  async listDue(scope: TodayActionOperationScope, now: Date): Promise<TodayActionState[]> {
    if (!Number.isFinite(now.getTime())) throw new Error('INVALID_REFERENCE_TIME');
    const rows = await this.sql<StateRow[]>`
      SELECT s.* FROM today_action_states s
      JOIN tenant_members m ON m.tenant_id=s.tenant_id AND m.id=s.member_id
      JOIN agent_tenants t ON t.id=s.tenant_id
      WHERE s.tenant_id=${scope.tenantId} AND s.member_id=${scope.memberId}
        AND m.feishu_open_id=${scope.actorOpenId} AND m.status='active'
        AND t.status='active' AND s.status='snoozed' AND s.remind_at<=${now}
      ORDER BY s.remind_at,s.item_id,s.item_version LIMIT 100`;
    return rows.map(stateFromRow);
  }

  async read(scope: TodayActionOperationScope, itemId: string, itemVersion: string): Promise<TodayActionState | null> {
    const rows = await this.sql<StateRow[]>`
      SELECT s.* FROM today_action_states s JOIN tenant_members m
      ON m.tenant_id=s.tenant_id AND m.id=s.member_id
      WHERE s.tenant_id=${scope.tenantId} AND s.member_id=${scope.memberId}
      AND m.feishu_open_id=${scope.actorOpenId} AND m.status='active'
      AND s.item_id=${itemId} AND s.item_version=${itemVersion}`;
    return rows[0] ? stateFromRow(rows[0]) : null;
  }

  async apply(scope: TodayActionOperationScope, request: TodayActionOperationRequest, now: Date): Promise<TodayActionState> {
    const fingerprint: string = createHash('sha256').update(JSON.stringify({
      itemId: request.itemId, itemVersion: request.itemVersion, operation: request.operation,
      expectedRevision: request.expectedRevision, remindAt: request.remindAt ?? null,
    })).digest('hex');
    return this.sql.begin(async (tx): Promise<TodayActionState> => {
      // Serialize the operation key before reading its durable result.
      await tx`SELECT pg_advisory_xact_lock(hashtextextended(
        ${`${scope.tenantId}:${scope.memberId}:${request.idempotencyKey}`},0))`;
      const members = await tx`SELECT id FROM tenant_members WHERE tenant_id=${scope.tenantId}
        AND id=${scope.memberId} AND feishu_open_id=${scope.actorOpenId} AND status='active'`;
      if (!members[0]) throw new Error('ACCESS_DENIED');
      const replay = await tx`SELECT request_fingerprint,result FROM today_action_operations
        WHERE tenant_id=${scope.tenantId} AND member_id=${scope.memberId}
        AND idempotency_key=${request.idempotencyKey}`;
      if (replay[0]) {
        if (replay[0].request_fingerprint !== fingerprint) throw new Error('IDEMPOTENCY_CONFLICT');
        return (typeof replay[0].result === 'string'
          ? JSON.parse(replay[0].result) : replay[0].result) as TodayActionState;
      }
      await tx`INSERT INTO today_action_states(tenant_id,member_id,item_id,item_version,status)
        VALUES(${scope.tenantId},${scope.memberId},${request.itemId},${request.itemVersion},'open')
        ON CONFLICT DO NOTHING`;
      const rows = await tx<StateRow[]>`SELECT * FROM today_action_states
        WHERE tenant_id=${scope.tenantId} AND member_id=${scope.memberId}
        AND item_id=${request.itemId} AND item_version=${request.itemVersion} FOR UPDATE`;
      const next: TodayActionState = transitionTodayAction(stateFromRow(rows[0]), request, now);
      await tx`UPDATE today_action_states SET revision=${next.revision},status=${next.status},
        remind_at=${next.remindAt},updated_at=${now} WHERE tenant_id=${scope.tenantId}
        AND member_id=${scope.memberId} AND item_id=${request.itemId} AND item_version=${request.itemVersion}`;
      await tx`INSERT INTO today_action_operations(tenant_id,member_id,idempotency_key,
        request_fingerprint,item_id,item_version,operation,result) VALUES(${scope.tenantId},
        ${scope.memberId},${request.idempotencyKey},${fingerprint},${request.itemId},
        ${request.itemVersion},${request.operation},${JSON.stringify(next)}::text::jsonb)`;
      await tx`INSERT INTO audit_events(tenant_id,trace_id,event_type,actor_open_id,entity_id,outcome,details)
        VALUES(${scope.tenantId},${randomUUID()},'today_action.updated',${scope.actorOpenId},
        ${request.itemId},'succeeded',${JSON.stringify({ operation: request.operation, revision: next.revision })}::text::jsonb)`;
      return next;
    });
  }
}
export { PostgresTodayActionStateStore };


