import { Inject, Injectable } from '@nestjs/common';
import type { Sql } from 'postgres';
import type {
  PlaybookPublicationEvent, PlaybookPublicationResponse, PublishedPlaybook, PublishedPlaybookListResponse,
} from '@shared/api.interface';
import { AGENT_DATABASE } from '@server/modules/control-store/postgres-control.store';
import { mapVersion, type DraftRow } from './postgres-playbook-authoring.repository';
import { parseSources } from './postgres-playbook-optimization.repository';
import type {
  PlaybookPublicationInput, PlaybookPublicationRepository, PlaybookPublicationResult,
} from './playbook-publication.ports';

interface PublicationRow {
  candidate_id: string; sequence: number; draft_version: number; approved_review_sequence: number;
  expected_publication_sequence: number; expected_review_sequence: number | null;
  request_id: string; actor_member_id: string; action: 'publish' | 'withdraw'; note: string; created_at: Date;
}
interface PublishedRow {
  candidate_id: string; version: number; publication_sequence: number; title: string;
  body: string; applicability: string; source_refs: unknown; published_at: Date;
}
const mapEvent = (row: PublicationRow): PlaybookPublicationEvent => ({
  candidateId: row.candidate_id, sequence: row.sequence, version: row.draft_version,
  approvedReviewSequence: row.approved_review_sequence, action: row.action, note: row.note,
  actorMemberId: row.actor_member_id, createdAt: row.created_at.toISOString(),
});
const mapPublished = (row: PublishedRow): PublishedPlaybook => ({
  candidateId: row.candidate_id, version: row.version, publicationSequence: row.publication_sequence,
  title: row.title, body: row.body, applicability: row.applicability,
  sources: parseSources(row.source_refs), publishedAt: row.published_at.toISOString(),
});

@Injectable()
class PostgresPlaybookPublicationRepository implements PlaybookPublicationRepository {
  constructor(@Inject(AGENT_DATABASE) private readonly sql: Sql) {}

  async list(input: { tenantId: string; candidateId: string; beforeSequence?: number; limit: number }):
  Promise<PlaybookPublicationResponse | null> {
    return this.sql.begin('ISOLATION LEVEL REPEATABLE READ READ ONLY', async (tx) => {
      const candidates = await tx`SELECT id FROM playbook_optimization_candidates
        WHERE tenant_id = ${input.tenantId}::uuid AND id = ${input.candidateId}::uuid`;
      if (candidates.length === 0) return null;
      const drafts = await tx<DraftRow[]>`SELECT * FROM playbook_draft_versions
        WHERE tenant_id = ${input.tenantId}::uuid AND candidate_id = ${input.candidateId}::uuid
        ORDER BY version DESC LIMIT 1`;
      const reviews = await tx<Array<{ sequence: number; draft_version: number; action: string }>>`
        SELECT sequence, draft_version, action FROM playbook_draft_review_events
        WHERE tenant_id = ${input.tenantId}::uuid AND candidate_id = ${input.candidateId}::uuid
        ORDER BY sequence DESC LIMIT 1`;
      const events = await tx<PublicationRow[]>`SELECT * FROM playbook_publication_events
        WHERE tenant_id = ${input.tenantId}::uuid AND candidate_id = ${input.candidateId}::uuid
        ORDER BY sequence DESC LIMIT 1`;
      const rows = await tx<PublicationRow[]>`SELECT * FROM playbook_publication_events
        WHERE tenant_id = ${input.tenantId}::uuid AND candidate_id = ${input.candidateId}::uuid
          AND sequence < ${input.beforeSequence ?? 2147483648}::bigint
        ORDER BY sequence DESC LIMIT ${input.limit + 1}`;
      const current: PublicationRow | undefined = events[0];
      const activeRows = current?.action === 'publish' ? await tx<PublishedRow[]>`
        SELECT d.candidate_id, d.version, d.title, d.body, d.applicability, d.source_refs,
          ${current.sequence}::integer AS publication_sequence, ${current.created_at}::timestamptz AS published_at
        FROM playbook_draft_versions d
        WHERE d.tenant_id = ${input.tenantId}::uuid AND d.candidate_id = ${input.candidateId}::uuid
          AND d.version = ${current.draft_version}` : [];
      const page: PublicationRow[] = rows.slice(0, input.limit);
      return {
        latestDraft: drafts[0] ? mapVersion(drafts[0]) : null,
        reviewSequence: reviews[0]?.sequence ?? 0,
        approvedVersion: reviews[0]?.action === 'approve' && reviews[0].draft_version === drafts[0]?.version
          ? reviews[0].draft_version : null,
        current: current ? mapEvent(current) : null, active: activeRows[0] ? mapPublished(activeRows[0]) : null,
        history: page.map(mapEvent),
        nextBeforeSequence: rows.length > input.limit ? page[page.length - 1].sequence : null,
      };
    });
  }

  async record(input: PlaybookPublicationInput): Promise<PlaybookPublicationResult> {
    return this.sql.begin(async (tx): Promise<PlaybookPublicationResult> => {
      const candidates = await tx<Array<{ status: string }>>`SELECT status FROM playbook_optimization_candidates
        WHERE tenant_id = ${input.tenantId}::uuid AND id = ${input.candidateId}::uuid FOR UPDATE`;
      if (!candidates[0]) return { status: 'not_found' };
      const replay = await tx<PublicationRow[]>`SELECT * FROM playbook_publication_events
        WHERE tenant_id = ${input.tenantId}::uuid AND candidate_id = ${input.candidateId}::uuid
          AND request_id = ${input.requestId}::uuid`;
      const original: PublicationRow | undefined = replay[0];
      if (original) {
        const matches: boolean = original.draft_version === input.expectedVersion &&
          original.expected_review_sequence === input.expectedReviewSequence &&
          original.expected_publication_sequence === input.expectedPublicationSequence &&
          original.actor_member_id === input.actorMemberId && original.action === input.action && original.note === input.note;
        return matches ? { status: 'recorded', event: mapEvent(original) } : { status: 'request_mismatch' };
      }
      const events = await tx<PublicationRow[]>`SELECT * FROM playbook_publication_events
        WHERE tenant_id = ${input.tenantId}::uuid AND candidate_id = ${input.candidateId}::uuid
        ORDER BY sequence DESC LIMIT 1`;
      const current: PublicationRow | undefined = events[0];
      const sequence: number = current?.sequence ?? 0;
      if (sequence !== input.expectedPublicationSequence) return { status: 'conflict' };
      let approvedSequence: number;
      if (input.action === 'withdraw') {
        if (current?.action !== 'publish' || current.draft_version !== input.expectedVersion) return { status: 'invalid_transition' };
        approvedSequence = current.approved_review_sequence;
      } else {
        if (candidates[0].status !== 'accepted_for_authoring') return { status: 'not_accepted' };
        const drafts = await tx<Array<{ version: number }>>`SELECT version FROM playbook_draft_versions
          WHERE tenant_id = ${input.tenantId}::uuid AND candidate_id = ${input.candidateId}::uuid
          ORDER BY version DESC LIMIT 1`;
        const reviews = await tx<Array<{ sequence: number; draft_version: number; action: string }>>`
          SELECT sequence, draft_version, action FROM playbook_draft_review_events
          WHERE tenant_id = ${input.tenantId}::uuid AND candidate_id = ${input.candidateId}::uuid
          ORDER BY sequence DESC LIMIT 1`;
        if (drafts[0]?.version !== input.expectedVersion || reviews[0]?.sequence !== input.expectedReviewSequence) {
          return { status: 'conflict' };
        }
        if (reviews[0].action !== 'approve' || reviews[0].draft_version !== input.expectedVersion ||
          (current?.action === 'publish' && current.draft_version === input.expectedVersion)) {
          return { status: 'invalid_transition' };
        }
        approvedSequence = reviews[0].sequence;
      }
      const inserted = await tx<PublicationRow[]>`INSERT INTO playbook_publication_events (
        tenant_id, candidate_id, sequence, draft_version, approved_review_sequence,
        expected_publication_sequence, expected_review_sequence, request_id, actor_member_id, action, note
      ) VALUES (${input.tenantId}::uuid, ${input.candidateId}::uuid, ${sequence + 1}, ${input.expectedVersion},
        ${approvedSequence}, ${input.expectedPublicationSequence}, ${input.expectedReviewSequence},
        ${input.requestId}::uuid, ${input.actorMemberId}::uuid, ${input.action}, ${input.note}) RETURNING *`;
      return { status: 'recorded', event: mapEvent(inserted[0]) };
    });
  }

  async getPublished(tenantId: string, candidateId: string): Promise<PublishedPlaybook | null> {
    const rows = await this.sql<PublishedRow[]>`
      SELECT d.candidate_id, d.version, d.title, d.body, d.applicability, d.source_refs,
        p.sequence AS publication_sequence, p.created_at AS published_at
      FROM playbook_publication_events p JOIN playbook_draft_versions d
        ON d.tenant_id = p.tenant_id AND d.candidate_id = p.candidate_id AND d.version = p.draft_version
      WHERE p.tenant_id = ${tenantId}::uuid AND p.candidate_id = ${candidateId}::uuid AND p.action = 'publish'
        AND NOT EXISTS (SELECT 1 FROM playbook_publication_events newer
          WHERE newer.tenant_id = p.tenant_id AND newer.candidate_id = p.candidate_id AND newer.sequence > p.sequence)`;
    return rows[0] ? mapPublished(rows[0]) : null;
  }

  async listPublished(input: { tenantId: string; afterCandidateId?: string; limit: number }):
  Promise<PublishedPlaybookListResponse> {
    const rows = await this.sql<PublishedRow[]>`
      WITH latest AS (
        SELECT DISTINCT ON (candidate_id) * FROM playbook_publication_events
        WHERE tenant_id = ${input.tenantId}::uuid
          AND (${input.afterCandidateId ?? null}::uuid IS NULL
            OR candidate_id > ${input.afterCandidateId ?? null}::uuid)
        ORDER BY candidate_id, sequence DESC
      )
      SELECT d.candidate_id, d.version, d.title, d.applicability,
        p.sequence AS publication_sequence, p.created_at AS published_at
      FROM latest p JOIN playbook_draft_versions d
        ON d.tenant_id = p.tenant_id AND d.candidate_id = p.candidate_id AND d.version = p.draft_version
      WHERE p.action = 'publish' ORDER BY p.candidate_id LIMIT ${input.limit + 1}`;
    const page: PublishedRow[] = rows.slice(0, input.limit);
    return {
      items: page.map((row: PublishedRow) => ({ candidateId: row.candidate_id, version: row.version,
        title: row.title, applicability: row.applicability, publicationSequence: row.publication_sequence,
        publishedAt: row.published_at.toISOString() })),
      nextAfterCandidateId: rows.length > input.limit ? page[page.length - 1].candidate_id : null,
    };
  }
}
export { PostgresPlaybookPublicationRepository };
