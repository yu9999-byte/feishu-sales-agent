import { Inject, Injectable } from '@nestjs/common';
import type { Sql } from 'postgres';
import type { PlaybookDraftResponse, PlaybookDraftVersion } from '@shared/api.interface';
import { AGENT_DATABASE } from '@server/modules/control-store/postgres-control.store';
import type {
  PlaybookAuthoringRepository, PlaybookDraftIdentity, PlaybookDraftSaveInput, PlaybookDraftSaveResult,
} from './playbook-authoring.ports';
import { parseSources } from './postgres-playbook-optimization.repository';

interface DraftRow {
  candidate_id: string; version: number; expected_version: number; request_id: string;
  author_member_id: string; title: string; body: string; applicability: string;
  change_note: string; source_refs: unknown; created_at: Date;
}
const mapVersion = (row: DraftRow): PlaybookDraftVersion => ({
  candidateId: row.candidate_id, version: row.version, title: row.title,
  body: row.body, applicability: row.applicability, changeNote: row.change_note,
  sources: parseSources(row.source_refs), authorMemberId: row.author_member_id,
  createdAt: row.created_at.toISOString(),
});

@Injectable()
class PostgresPlaybookAuthoringRepository implements PlaybookAuthoringRepository {
  constructor(@Inject(AGENT_DATABASE) private readonly sql: Sql) {}

  async list(input: PlaybookDraftIdentity & { beforeVersion?: number; limit: number }):
  Promise<PlaybookDraftResponse | null> {
    return this.sql.begin('ISOLATION LEVEL REPEATABLE READ READ ONLY', async (tx) => {
      const candidates = await tx`
        SELECT id FROM playbook_optimization_candidates
        WHERE tenant_id = ${input.tenantId}::uuid AND id = ${input.candidateId}::uuid
      `;
      if (candidates.length === 0) return null;
      const latest = await tx<DraftRow[]>`
        SELECT * FROM playbook_draft_versions
        WHERE tenant_id = ${input.tenantId}::uuid AND candidate_id = ${input.candidateId}::uuid
        ORDER BY version DESC LIMIT 1
      `;
      const rows = await tx<DraftRow[]>`
        SELECT version, title, change_note, author_member_id, created_at
        FROM playbook_draft_versions
        WHERE tenant_id = ${input.tenantId}::uuid AND candidate_id = ${input.candidateId}::uuid
          AND version < ${input.beforeVersion ?? 2147483648}::bigint
        ORDER BY version DESC LIMIT ${input.limit + 1}
      `;
      const page: DraftRow[] = rows.slice(0, input.limit);
      return {
        latest: latest[0] ? mapVersion(latest[0]) : null,
        history: page.map((row: DraftRow) => ({
          version: row.version, title: row.title, changeNote: row.change_note,
          authorMemberId: row.author_member_id, createdAt: row.created_at.toISOString(),
        })),
        nextBeforeVersion: rows.length > input.limit ? page[page.length - 1].version : null,
      };
    });
  }

  async get(input: PlaybookDraftIdentity & { version: number }): Promise<PlaybookDraftVersion | null> {
    const rows = await this.sql<DraftRow[]>`
      SELECT * FROM playbook_draft_versions
      WHERE tenant_id = ${input.tenantId}::uuid AND candidate_id = ${input.candidateId}::uuid
        AND version = ${input.version}
    `;
    return rows[0] ? mapVersion(rows[0]) : null;
  }

  async save(input: PlaybookDraftSaveInput): Promise<PlaybookDraftSaveResult> {
    return this.sql.begin(async (tx): Promise<PlaybookDraftSaveResult> => {
      // The parent lock also serializes competing first versions and source observations.
      const candidates = await tx<Array<{ status: string; source_refs: unknown }>>`
        SELECT status, source_refs FROM playbook_optimization_candidates
        WHERE tenant_id = ${input.tenantId}::uuid AND id = ${input.candidateId}::uuid FOR UPDATE
      `;
      const candidate = candidates[0];
      if (!candidate) return { status: 'not_found' };
      if (candidate.status !== 'accepted_for_authoring') return { status: 'not_accepted' };
      const replay = await tx<DraftRow[]>`
        SELECT * FROM playbook_draft_versions
        WHERE tenant_id = ${input.tenantId}::uuid AND candidate_id = ${input.candidateId}::uuid
          AND request_id = ${input.requestId}::uuid
      `;
      const original: DraftRow | undefined = replay[0];
      if (original) {
        const matches: boolean = original.expected_version === input.expectedVersion &&
          original.author_member_id === input.authorMemberId && original.title === input.title &&
          original.body === input.body && original.applicability === input.applicability &&
          original.change_note === input.changeNote;
        return matches ? { status: 'saved', version: mapVersion(original) } : { status: 'request_mismatch' };
      }
      const latest = await tx<Array<{ version: number }>>`
        SELECT version FROM playbook_draft_versions
        WHERE tenant_id = ${input.tenantId}::uuid AND candidate_id = ${input.candidateId}::uuid
        ORDER BY version DESC LIMIT 1
      `;
      if ((latest[0]?.version ?? 0) !== input.expectedVersion) return { status: 'conflict' };
      const rows = await tx<DraftRow[]>`
        INSERT INTO playbook_draft_versions (
          tenant_id, candidate_id, version, expected_version, request_id, author_member_id,
          title, body, applicability, change_note, source_refs
        ) VALUES (
          ${input.tenantId}::uuid, ${input.candidateId}::uuid, ${input.expectedVersion + 1},
          ${input.expectedVersion}, ${input.requestId}::uuid, ${input.authorMemberId}::uuid,
          ${input.title}, ${input.body}, ${input.applicability}, ${input.changeNote},
          ${JSON.stringify(candidate.source_refs)}::text::jsonb
        ) RETURNING *
      `;
      return { status: 'saved', version: mapVersion(rows[0]) };
    });
  }
}

export { PostgresPlaybookAuthoringRepository, mapVersion };
export type { DraftRow };
