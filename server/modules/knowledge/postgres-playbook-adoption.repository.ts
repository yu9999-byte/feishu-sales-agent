import { Inject, Injectable } from '@nestjs/common';
import type { Sql } from 'postgres';
import type { PlaybookAdoptionEvent, PlaybookAdoptionResponse } from '@shared/api.interface';
import { AGENT_DATABASE } from '@server/modules/control-store/postgres-control.store';
import type { PlaybookAdoptionInput, PlaybookAdoptionRepository, PlaybookAdoptionResult } from './playbook-adoption.ports';

interface AdoptionRow {
  candidate_id: string; sequence: number; publication_version: number; publication_sequence: number;
  expected_adoption_sequence: number; request_id: string; actor_member_id: string;
  action: 'record' | 'retract'; evidence_kind: 'followup' | 'opportunity' | 'task' | null;
  evidence_record_id: string | null; evidence_action_id: string | null; evidence_note: string | null;
  note: string; created_at: Date;
}
interface PublicationRow { sequence: number; draft_version: number; action: 'publish' | 'withdraw'; }
interface ActionRow { actor_open_id: string; status: string; payload: unknown; result: unknown; }
const object = (value: unknown): Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {};
const mapEvent = (row: AdoptionRow): PlaybookAdoptionEvent => ({
  candidateId: row.candidate_id, sequence: row.sequence, publicationVersion: row.publication_version,
  publicationSequence: row.publication_sequence, action: row.action,
  evidence: row.evidence_kind && row.evidence_record_id && row.evidence_action_id && row.evidence_note ? {
    kind: row.evidence_kind, recordId: row.evidence_record_id, actionId: row.evidence_action_id, note: row.evidence_note,
  } : null, note: row.note, actorMemberId: row.actor_member_id, createdAt: row.created_at.toISOString(),
});

@Injectable()
class PostgresPlaybookAdoptionRepository implements PlaybookAdoptionRepository {
  constructor(@Inject(AGENT_DATABASE) private readonly sql: Sql) {}

  async list(input: { tenantId: string; candidateId: string; beforeSequence?: number; limit: number }):
  Promise<PlaybookAdoptionResponse | null> {
    return this.sql.begin('ISOLATION LEVEL REPEATABLE READ READ ONLY', async (tx) => {
      const candidates = await tx`SELECT id FROM playbook_optimization_candidates
        WHERE tenant_id = ${input.tenantId}::uuid AND id = ${input.candidateId}::uuid`;
      if (candidates.length === 0) return null;
      const publications = await tx<PublicationRow[]>`SELECT sequence, draft_version, action
        FROM playbook_publication_events WHERE tenant_id = ${input.tenantId}::uuid
          AND candidate_id = ${input.candidateId}::uuid ORDER BY sequence DESC LIMIT 1`;
      const currentPublication: PublicationRow | undefined = publications[0];
      const latest = await tx<AdoptionRow[]>`SELECT * FROM playbook_adoption_events
        WHERE tenant_id = ${input.tenantId}::uuid AND candidate_id = ${input.candidateId}::uuid
        ORDER BY sequence DESC LIMIT 1`;
      const rows = await tx<AdoptionRow[]>`SELECT * FROM playbook_adoption_events
        WHERE tenant_id = ${input.tenantId}::uuid AND candidate_id = ${input.candidateId}::uuid
          AND sequence < ${input.beforeSequence ?? 2147483648}::bigint
        ORDER BY sequence DESC LIMIT ${input.limit + 1}`;
      const active = currentPublication?.action === 'publish' ? currentPublication : undefined;
      const currentRow = active && latest[0] && latest[0].publication_sequence === active.sequence &&
        latest[0].publication_version === active.draft_version ? latest[0] : undefined;
      const counts = active ? await tx<Array<{ records: number; retractions: number }>>`SELECT
        count(*) FILTER (WHERE action = 'record')::integer AS records,
        count(*) FILTER (WHERE action = 'retract')::integer AS retractions
        FROM playbook_adoption_events WHERE tenant_id = ${input.tenantId}::uuid
          AND candidate_id = ${input.candidateId}::uuid AND publication_sequence = ${active.sequence}
          AND publication_version = ${active.draft_version}` : [{ records: 0, retractions: 0 }];
      const page: AdoptionRow[] = rows.slice(0, input.limit);
      const status = currentRow?.action === 'record' ? 'adopted' : currentRow?.action === 'retract' ? 'retracted' : 'not_adopted';
      return {
        publication: active ? { version: active.draft_version, publicationSequence: active.sequence } : null,
        adoptionSequence: latest[0]?.sequence ?? 0, status,
        verifiedAdoptionCount: counts[0]?.records ?? 0, retractionCount: counts[0]?.retractions ?? 0,
        current: currentRow ? mapEvent(currentRow) : null, history: page.map(mapEvent),
        nextBeforeSequence: rows.length > input.limit ? page[page.length - 1].sequence : null,
      };
    });
  }

  async record(input: PlaybookAdoptionInput): Promise<PlaybookAdoptionResult> {
    return this.sql.begin(async (tx): Promise<PlaybookAdoptionResult> => {
      const candidates = await tx`SELECT id FROM playbook_optimization_candidates
        WHERE tenant_id = ${input.tenantId}::uuid AND id = ${input.candidateId}::uuid FOR UPDATE`;
      if (!candidates[0]) return { status: 'not_found' };
      const replay = await tx<AdoptionRow[]>`SELECT * FROM playbook_adoption_events
        WHERE tenant_id = ${input.tenantId}::uuid AND candidate_id = ${input.candidateId}::uuid
          AND request_id = ${input.requestId}::uuid`;
      const original = replay[0];
      if (original) {
        const evidence = input.evidence;
        const matches = original.expected_adoption_sequence === input.expectedAdoptionSequence &&
          original.publication_version === input.publicationVersion && original.publication_sequence === input.publicationSequence &&
          original.actor_member_id === input.actorMemberId && original.action === input.action && original.note === input.note &&
          original.evidence_kind === (evidence?.kind ?? null) && original.evidence_record_id === (evidence?.recordId ?? null) &&
          original.evidence_action_id === (evidence?.actionId ?? null) && original.evidence_note === (evidence?.note ?? null);
        return matches ? { status: 'recorded', event: mapEvent(original) } : { status: 'request_mismatch' };
      }
      const publications = await tx<PublicationRow[]>`SELECT sequence, draft_version, action
        FROM playbook_publication_events WHERE tenant_id = ${input.tenantId}::uuid
          AND candidate_id = ${input.candidateId}::uuid ORDER BY sequence DESC LIMIT 1`;
      const publication = publications[0];
      if (!publication) return { status: 'no_publication' };
      if (publication.action !== 'publish') return { status: 'invalid_transition' };
      if (publication.sequence !== input.publicationSequence || publication.draft_version !== input.publicationVersion) {
        return { status: 'conflict' };
      }
      const latest = await tx<Array<{ sequence: number }>>`SELECT sequence FROM playbook_adoption_events
        WHERE tenant_id = ${input.tenantId}::uuid AND candidate_id = ${input.candidateId}::uuid
        ORDER BY sequence DESC LIMIT 1`;
      const sequence: number = latest[0]?.sequence ?? 0;
      if (sequence !== input.expectedAdoptionSequence) return { status: 'conflict' };
      if (input.action === 'record') {
        const evidence = input.evidence;
        if (!evidence) return { status: 'invalid_evidence' };
        const actions = await tx<ActionRow[]>`SELECT actor_open_id, status, payload, result FROM pending_actions
          WHERE tenant_id = ${input.tenantId}::uuid AND id = ${evidence.actionId}::uuid FOR SHARE`;
        const action = actions[0];
        const result = object(action?.result);
        const expected = evidence.kind === 'followup' ? result.followupRecordId :
          evidence.kind === 'opportunity' ? result.opportunityRecordId : result.taskGuid;
        if (!action || action.actor_open_id !== input.actorOpenId ||
          !['succeeded', 'partialFailure'].includes(action.status) || expected !== evidence.recordId) {
          return { status: 'invalid_evidence' };
        }
      }
      const inserted = await tx<AdoptionRow[]>`INSERT INTO playbook_adoption_events (
        tenant_id, candidate_id, sequence, publication_version, publication_sequence,
        expected_adoption_sequence, request_id, actor_member_id, action, evidence_kind,
        evidence_record_id, evidence_action_id, evidence_note, note
      ) VALUES (${input.tenantId}::uuid, ${input.candidateId}::uuid, ${sequence + 1},
        ${input.publicationVersion}, ${input.publicationSequence}, ${input.expectedAdoptionSequence},
        ${input.requestId}::uuid, ${input.actorMemberId}::uuid, ${input.action},
        ${input.evidence?.kind ?? null}, ${input.evidence?.recordId ?? null},
        ${input.evidence?.actionId ?? null}::uuid, ${input.evidence?.note ?? null}, ${input.note}) RETURNING *`;
      return { status: 'recorded', event: mapEvent(inserted[0]) };
    });
  }
}
export { PostgresPlaybookAdoptionRepository };
