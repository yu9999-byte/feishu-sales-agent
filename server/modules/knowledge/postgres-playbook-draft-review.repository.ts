import { Inject, Injectable } from '@nestjs/common';
import type { Sql } from 'postgres';
import type { PlaybookDraftReviewEvent, PlaybookDraftReviewResponse } from '@shared/api.interface';
import { AGENT_DATABASE } from '@server/modules/control-store/postgres-control.store';
import type {
  PlaybookDraftReviewInput, PlaybookDraftReviewRepository, PlaybookDraftReviewResult,
} from './playbook-authoring.ports';

interface ReviewRow {
  candidate_id: string;
  sequence: number;
  draft_version: number;
  request_id: string;
  actor_member_id: string;
  action: PlaybookDraftReviewEvent['action'];
  note: string;
  created_at: Date;
  expected_version: number;
  expected_review_sequence: number;
}

const mapEvent = (row: ReviewRow): PlaybookDraftReviewEvent => ({
  candidateId: row.candidate_id,
  sequence: row.sequence,
  version: row.draft_version,
  action: row.action,
  note: row.note,
  actorMemberId: row.actor_member_id,
  createdAt: row.created_at.toISOString(),
});

@Injectable()
class PostgresPlaybookDraftReviewRepository implements PlaybookDraftReviewRepository {
  constructor(@Inject(AGENT_DATABASE) private readonly sql: Sql) {}

  async list(input: { tenantId: string; candidateId: string; beforeSequence?: number; limit: number }):
  Promise<PlaybookDraftReviewResponse | null> {
    return this.sql.begin('ISOLATION LEVEL REPEATABLE READ READ ONLY', async (tx) => {
      const candidates = await tx`
        SELECT id FROM playbook_optimization_candidates
        WHERE tenant_id = ${input.tenantId}::uuid AND id = ${input.candidateId}::uuid
      `;
      if (candidates.length === 0) return null;
      const drafts = await tx<Array<{ version: number }>>`
        SELECT version FROM playbook_draft_versions
        WHERE tenant_id = ${input.tenantId}::uuid AND candidate_id = ${input.candidateId}::uuid
        ORDER BY version DESC LIMIT 1
      `;
      const latestEvents = await tx<ReviewRow[]>`
        SELECT candidate_id, sequence, draft_version, request_id, actor_member_id, action,
          note, created_at, expected_version, expected_review_sequence
        FROM playbook_draft_review_events
        WHERE tenant_id = ${input.tenantId}::uuid AND candidate_id = ${input.candidateId}::uuid
        ORDER BY sequence DESC LIMIT 1
      `;
      const rows = await tx<ReviewRow[]>`
        SELECT candidate_id, sequence, draft_version, request_id, actor_member_id, action,
          note, created_at, expected_version, expected_review_sequence
        FROM playbook_draft_review_events
        WHERE tenant_id = ${input.tenantId}::uuid AND candidate_id = ${input.candidateId}::uuid
          AND sequence < ${input.beforeSequence ?? 2147483648}::bigint
        ORDER BY sequence DESC LIMIT ${input.limit + 1}
      `;
      const page: ReviewRow[] = rows.slice(0, input.limit);
      const latestDraftVersion: number | null = drafts[0]?.version ?? null;
      const current: PlaybookDraftReviewEvent | null = latestEvents[0] ? mapEvent(latestEvents[0]) : null;
      const status: PlaybookDraftReviewResponse['status'] = !current ? 'not_submitted' :
        current.version < (latestDraftVersion ?? 0) ? 'superseded' :
          current.action === 'submit' ? 'pending_review' :
            current.action === 'approve' ? 'approved' : 'changes_requested';
      return {
        latestDraftVersion, status, current, history: page.map(mapEvent),
        nextBeforeSequence: rows.length > input.limit ? page[page.length - 1].sequence : null,
      };
    });
  }

  async record(input: PlaybookDraftReviewInput): Promise<PlaybookDraftReviewResult> {
    return this.sql.begin(async (tx): Promise<PlaybookDraftReviewResult> => {
      const candidates = await tx<Array<{ status: string }>>`
        SELECT status FROM playbook_optimization_candidates
        WHERE tenant_id = ${input.tenantId}::uuid AND id = ${input.candidateId}::uuid FOR UPDATE
      `;
      if (!candidates[0]) return { status: 'not_found' };
      if (candidates[0].status !== 'accepted_for_authoring') return { status: 'not_accepted' };
      const replay = await tx<ReviewRow[]>`
        SELECT candidate_id, sequence, draft_version, request_id, actor_member_id, action,
          note, created_at, expected_version, expected_review_sequence
        FROM playbook_draft_review_events
        WHERE tenant_id = ${input.tenantId}::uuid AND candidate_id = ${input.candidateId}::uuid
          AND request_id = ${input.requestId}::uuid
      `;
      const original: ReviewRow | undefined = replay[0];
      if (original) {
        const matches: boolean = original.expected_version === input.expectedVersion &&
          original.expected_review_sequence === input.expectedReviewSequence &&
          original.actor_member_id === input.actorMemberId && original.action === input.action &&
          original.note === input.note;
        return matches ? { status: 'recorded', event: mapEvent(original) } : { status: 'request_mismatch' };
      }
      const drafts = await tx<Array<{ version: number }>>`
        SELECT version FROM playbook_draft_versions
        WHERE tenant_id = ${input.tenantId}::uuid AND candidate_id = ${input.candidateId}::uuid
        ORDER BY version DESC LIMIT 1
      `;
      const events = await tx<Array<{ sequence: number; draft_version: number; action: string }>>`
        SELECT sequence, draft_version, action FROM playbook_draft_review_events
        WHERE tenant_id = ${input.tenantId}::uuid AND candidate_id = ${input.candidateId}::uuid
        ORDER BY sequence DESC LIMIT 1
      `;
      const latestVersion: number = drafts[0]?.version ?? 0;
      const latestEvent = events[0];
      const sequence: number = latestEvent?.sequence ?? 0;
      if (latestVersion !== input.expectedVersion || sequence !== input.expectedReviewSequence) return { status: 'conflict' };
      const currentVersionPending: boolean = latestEvent?.draft_version === latestVersion && latestEvent.action === 'submit';
      const currentVersionFinal: boolean = latestEvent?.draft_version === latestVersion &&
        (latestEvent.action === 'approve' || latestEvent.action === 'request_changes');
      if (input.action === 'submit' && (currentVersionPending || currentVersionFinal)) return { status: 'invalid_transition' };
      if (input.action !== 'submit' && !(currentVersionPending && !currentVersionFinal)) return { status: 'invalid_transition' };
      const inserted = await tx<ReviewRow[]>`
        INSERT INTO playbook_draft_review_events (
          tenant_id, candidate_id, sequence, draft_version, expected_version, expected_review_sequence,
          request_id, actor_member_id, action, note
        ) VALUES (
          ${input.tenantId}::uuid, ${input.candidateId}::uuid, ${sequence + 1}, ${input.expectedVersion},
          ${input.expectedVersion}, ${input.expectedReviewSequence}, ${input.requestId}::uuid,
          ${input.actorMemberId}::uuid, ${input.action}, ${input.note}
        ) RETURNING candidate_id, sequence, draft_version, request_id, actor_member_id, action,
          note, created_at, expected_version, expected_review_sequence
      `;
      return { status: 'recorded', event: mapEvent(inserted[0]) };
    });
  }
}

export { PostgresPlaybookDraftReviewRepository };
