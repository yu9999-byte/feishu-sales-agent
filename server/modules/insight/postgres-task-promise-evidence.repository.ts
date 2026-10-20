import { Inject, Injectable } from '@nestjs/common';
import type { Sql } from 'postgres';
import type { TaskPromiseEvidenceEvent } from '@shared/api.interface';
import { AGENT_DATABASE } from '@server/modules/control-store/postgres-control.store';
import { followupPromiseNextAction } from './followup-promise';
import type { TaskPromiseEvidenceInput, TaskPromiseEvidenceOwner, TaskPromiseEvidenceRepository,
  TaskPromiseEvidenceReadResult, TaskPromiseEvidenceWriteResult } from './task-promise-evidence.ports';

interface ActionRow { status: string; payload: unknown; result: { taskGuid?: unknown } }
interface EvidenceRow {
  action_id: string;
  revision: number;
  expected_revision: number;
  request_id: string;
  actor_member_id: string;
  actor_open_id: string;
  state: TaskPromiseEvidenceEvent['state'];
  note: string;
  evidence_url: string | null;
  created_at: Date;
}
const eligible = (row: ActionRow): boolean => row.status === 'succeeded' &&
  followupPromiseNextAction(row.payload) !== null &&
  (row.result?.taskGuid === undefined || row.result?.taskGuid === null ||
    (typeof row.result?.taskGuid === 'string' && !row.result.taskGuid.trim()));
const event = (row: EvidenceRow): TaskPromiseEvidenceEvent => ({
  actionId: row.action_id, revision: row.revision, state: row.state, note: row.note,
  evidenceUrl: row.evidence_url, actorMemberId: row.actor_member_id, createdAt: row.created_at.toISOString(),
});

@Injectable()
class PostgresTaskPromiseEvidenceRepository implements TaskPromiseEvidenceRepository {
  constructor(@Inject(AGENT_DATABASE) private readonly sql: Sql) {}

  async list(input: TaskPromiseEvidenceOwner & { beforeRevision?: number; limit: number }):
  Promise<TaskPromiseEvidenceReadResult> {
    return this.sql.begin('ISOLATION LEVEL REPEATABLE READ READ ONLY', async (tx): Promise<TaskPromiseEvidenceReadResult> => {
      const actions = await tx<ActionRow[]>`
        SELECT status, payload, result FROM pending_actions
        WHERE tenant_id = ${input.tenantId}::uuid AND id = ${input.actionId}::uuid AND actor_open_id = ${input.actorOpenId}
      `;
      if (!actions[0]) return { status: 'not_found' };
      if (!eligible(actions[0])) return { status: 'ineligible' };
      const latest = await tx<EvidenceRow[]>`
        SELECT * FROM task_promise_evidence_events
        WHERE tenant_id = ${input.tenantId}::uuid AND action_id = ${input.actionId}::uuid
        ORDER BY revision DESC LIMIT 1
      `;
      const rows = await tx<EvidenceRow[]>`
        SELECT * FROM task_promise_evidence_events
        WHERE tenant_id = ${input.tenantId}::uuid AND action_id = ${input.actionId}::uuid
          AND revision < ${input.beforeRevision ?? 2147483648}::bigint
        ORDER BY revision DESC LIMIT ${input.limit + 1}
      `;
      const page: EvidenceRow[] = rows.slice(0, input.limit);
      return { status: 'found', response: { revision: latest[0]?.revision ?? 0,
        current: latest[0] ? event(latest[0]) : null, history: page.map(event),
        nextBeforeRevision: rows.length > input.limit ? page[page.length - 1].revision : null } };
    });
  }

  async record(input: TaskPromiseEvidenceInput): Promise<TaskPromiseEvidenceWriteResult> {
    return this.sql.begin(async (tx): Promise<TaskPromiseEvidenceWriteResult> => {
      const actions = await tx<ActionRow[]>`
        SELECT status, payload, result FROM pending_actions
        WHERE tenant_id = ${input.tenantId}::uuid AND id = ${input.actionId}::uuid
          AND actor_open_id = ${input.actorOpenId} FOR UPDATE
      `;
      if (!actions[0]) return { status: 'not_found' };
      if (!eligible(actions[0])) return { status: 'ineligible' };
      const replay = await tx<EvidenceRow[]>`
        SELECT * FROM task_promise_evidence_events
        WHERE tenant_id = ${input.tenantId}::uuid AND action_id = ${input.actionId}::uuid
          AND request_id = ${input.requestId}::uuid
      `;
      const original: EvidenceRow | undefined = replay[0];
      if (original) {
        const matches: boolean = original.expected_revision === input.expectedRevision &&
          original.actor_member_id === input.actorMemberId && original.actor_open_id === input.actorOpenId &&
          original.state === input.state && original.note === input.note && original.evidence_url === input.evidenceUrl;
        return matches ? { status: 'recorded', event: event(original) } : { status: 'request_mismatch' };
      }
      const latest = await tx<Array<{ revision: number }>>`
        SELECT revision FROM task_promise_evidence_events
        WHERE tenant_id = ${input.tenantId}::uuid AND action_id = ${input.actionId}::uuid
        ORDER BY revision DESC LIMIT 1
      `;
      if ((latest[0]?.revision ?? 0) !== input.expectedRevision) return { status: 'conflict' };
      const rows = await tx<EvidenceRow[]>`
        INSERT INTO task_promise_evidence_events (tenant_id, action_id, revision, expected_revision,
          request_id, actor_member_id, actor_open_id, state, note, evidence_url)
        VALUES (${input.tenantId}::uuid, ${input.actionId}::uuid, ${input.expectedRevision + 1}, ${input.expectedRevision},
          ${input.requestId}::uuid, ${input.actorMemberId}::uuid, ${input.actorOpenId}, ${input.state},
          ${input.note}, ${input.evidenceUrl}) RETURNING *
      `;
      return { status: 'recorded', event: event(rows[0]) };
    });
  }
}
export { PostgresTaskPromiseEvidenceRepository };
