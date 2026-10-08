import { Inject, Injectable } from '@nestjs/common';
import type { Sql } from 'postgres';

import type {
  PlaybookOptimizationCandidate,
  PlaybookOptimizationCandidateStatus,
  PlaybookOptimizationReason,
  PlaybookOptimizationSourceRef,
  SalesKnowledgeQaStatus,
} from '@shared/api.interface';
import { AGENT_DATABASE } from
  '@server/modules/control-store/postgres-control.store';
import type {
  PlaybookOptimizationListInput,
  PlaybookOptimizationRecordInput,
  PlaybookOptimizationRepository,
  PlaybookOptimizationReviewInput,
  PlaybookOptimizationReviewResult,
} from './playbook-optimization.ports';

interface CandidateRow {
  id: string;
  topic_preview: string;
  last_qa_status: SalesKnowledgeQaStatus;
  occurrence_count: number;
  reasons: unknown;
  source_refs: unknown;
  status: PlaybookOptimizationCandidateStatus;
  first_observed_at: Date | string;
  last_observed_at: Date | string;
  updated_at: Date | string;
}

interface ReviewIdRow { id: string }

const VALID_REASONS: PlaybookOptimizationReason[] = [
  'no_trusted_answer',
  'frequent_question',
  'source_unavailable',
  'source_revision_changed',
];

const toDate = (value: Date | string): Date =>
  value instanceof Date ? value : new Date(value);

const parseReasons = (value: unknown): PlaybookOptimizationReason[] =>
  Array.isArray(value)
    ? value.filter((item): item is PlaybookOptimizationReason =>
        typeof item === 'string' && VALID_REASONS.includes(
          item as PlaybookOptimizationReason,
        ),
      )
    : [];

const parseSources = (value: unknown): PlaybookOptimizationSourceRef[] =>
  Array.isArray(value)
    ? value.flatMap((item: unknown): PlaybookOptimizationSourceRef[] => {
        if (typeof item !== 'object' || item === null) return [];
        const candidate = item as Record<string, unknown>;
        const sourceId: unknown = candidate.sourceId;
        const sourceVersion: unknown = candidate.sourceVersion;
        if (
          typeof sourceId !== 'string' ||
          !(
            sourceVersion === null ||
            typeof sourceVersion === 'string'
          )
        ) return [];
        return [{
          sourceId,
          sourceVersion: sourceVersion as string | null,
        }];
      })
    : [];

const revisionChanged = (
  previous: PlaybookOptimizationSourceRef[],
  current: PlaybookOptimizationSourceRef[],
): boolean => {
  const previousVersions: Map<string, string> = new Map(
    previous.flatMap((source): Array<[string, string]> =>
      source.sourceVersion === null
        ? []
        : [[source.sourceId, source.sourceVersion]],
    ),
  );
  return current.some((source): boolean => {
    const previousVersion: string | undefined = previousVersions.get(source.sourceId);
    return previousVersion !== undefined && source.sourceVersion !== null &&
      previousVersion !== source.sourceVersion;
  });
};

@Injectable()
class PostgresPlaybookOptimizationRepository
implements PlaybookOptimizationRepository {
  constructor(
    @Inject(AGENT_DATABASE)
    private readonly sql: Sql,
  ) {}

  async observe(
    input: PlaybookOptimizationRecordInput,
  ): Promise<PlaybookOptimizationCandidate> {
    return this.sql.begin(async (tx): Promise<PlaybookOptimizationCandidate> => {
      const existingRows: CandidateRow[] = await tx<CandidateRow[]>`
        SELECT
          id, topic_preview, last_qa_status, occurrence_count,
          reasons, source_refs, status, first_observed_at,
          last_observed_at, updated_at
        FROM playbook_optimization_candidates
        WHERE tenant_id = ${input.tenantId}::uuid
          AND question_fingerprint = ${input.questionFingerprint}
        FOR UPDATE
      `;
      const existing: CandidateRow | undefined = existingRows[0];
      const count: number = (existing?.occurrence_count ?? 0) + 1;
      const previousReasons: PlaybookOptimizationReason[] =
        parseReasons(existing?.reasons);
      const reasons: PlaybookOptimizationReason[] = [
        ...new Set([
          ...previousReasons,
          ...input.reasons,
          ...(count >= 3 ? ['frequent_question' as const] : []),
          ...(existing && revisionChanged(
            parseSources(existing.source_refs),
            input.sources,
          ) ? ['source_revision_changed' as const] : []),
        ]),
      ];
      const humanReviewed: boolean = existing?.status === 'accepted_for_authoring' ||
        existing?.status === 'dismissed';
      const nextStatus: PlaybookOptimizationCandidateStatus = humanReviewed
        ? existing.status
        : reasons.length > 0 ? 'pending_review' : 'observing';
      let rows: CandidateRow[];
      if (existing === undefined) {
        rows = await tx<CandidateRow[]>`
          INSERT INTO playbook_optimization_candidates (
            tenant_id, question_fingerprint, topic_preview,
            last_qa_status, occurrence_count, reasons, source_refs,
            status, first_observed_at, last_observed_at, updated_at
          ) VALUES (
            ${input.tenantId}::uuid,
            ${input.questionFingerprint},
            ${input.topicPreview},
            ${input.qaStatus},
            ${count},
            ${JSON.stringify(reasons)}::text::jsonb,
            ${JSON.stringify(input.sources)}::text::jsonb,
            ${nextStatus},
            ${input.observedAt},
            ${input.observedAt},
            ${input.observedAt}
          )
          RETURNING
            id, topic_preview, last_qa_status, occurrence_count,
            reasons, source_refs, status, first_observed_at,
            last_observed_at, updated_at
        `;
      } else {
        rows = await tx<CandidateRow[]>`
          UPDATE playbook_optimization_candidates
          SET
            topic_preview = ${input.topicPreview},
            last_qa_status = ${input.qaStatus},
            occurrence_count = ${count},
            reasons = ${JSON.stringify(reasons)}::text::jsonb,
            source_refs = ${JSON.stringify(input.sources)}::text::jsonb,
            status = ${nextStatus},
            last_observed_at = ${input.observedAt},
            updated_at = ${input.observedAt}
          WHERE tenant_id = ${input.tenantId}::uuid
            AND id = ${existing.id}::uuid
          RETURNING
            id, topic_preview, last_qa_status, occurrence_count,
            reasons, source_refs, status, first_observed_at,
            last_observed_at, updated_at
        `;
      }
      const row: CandidateRow | undefined = rows[0];
      if (row === undefined) throw new Error('Failed to save playbook candidate');
      return this.mapCandidate(row);
    });
  }

  async list(
    input: PlaybookOptimizationListInput,
  ): Promise<PlaybookOptimizationCandidate[]> {
    const rows: CandidateRow[] = await this.sql<CandidateRow[]>`
      SELECT
        id, topic_preview, last_qa_status, occurrence_count,
        reasons, source_refs, status, first_observed_at,
        last_observed_at, updated_at
      FROM playbook_optimization_candidates
      WHERE tenant_id = ${input.tenantId}::uuid
      ORDER BY
        CASE status
          WHEN 'pending_review' THEN 0
          WHEN 'observing' THEN 1
          WHEN 'accepted_for_authoring' THEN 2
          ELSE 3
        END,
        last_observed_at DESC,
        id ASC
      LIMIT ${input.limit}
    `;
    return rows.map((row: CandidateRow) => this.mapCandidate(row));
  }

  async review(
    input: PlaybookOptimizationReviewInput,
  ): Promise<PlaybookOptimizationReviewResult> {
    return this.sql.begin(async (tx): Promise<PlaybookOptimizationReviewResult> => {
      const resultingStatus: PlaybookOptimizationCandidateStatus =
        input.decision === 'accept_for_authoring'
          ? 'accepted_for_authoring'
          : 'dismissed';
      const rows: CandidateRow[] = await tx<CandidateRow[]>`
        UPDATE playbook_optimization_candidates
        SET status = ${resultingStatus}, updated_at = ${input.reviewedAt}
        WHERE tenant_id = ${input.tenantId}::uuid
          AND id = ${input.candidateId}::uuid
          AND status = 'pending_review'
          AND updated_at = ${input.expectedUpdatedAt}
        RETURNING
          id, topic_preview, last_qa_status, occurrence_count,
          reasons, source_refs, status, first_observed_at,
          last_observed_at, updated_at
      `;
      const updated: CandidateRow | undefined = rows[0];
      if (updated === undefined) {
        const currentRows = await tx<{ updated_at: Date | string }[]>`
          SELECT updated_at
          FROM playbook_optimization_candidates
          WHERE tenant_id = ${input.tenantId}::uuid
            AND id = ${input.candidateId}::uuid
          LIMIT 1
        `;
        const current = currentRows[0];
        return current === undefined
          ? { status: 'not_found' }
          : {
              status: 'conflict',
              currentUpdatedAt: toDate(current.updated_at),
            };
      }
      const reviews: ReviewIdRow[] = await tx<ReviewIdRow[]>`
        INSERT INTO playbook_optimization_reviews (
          tenant_id, candidate_id, reviewer_member_id,
          decision, previous_status, resulting_status,
          expected_updated_at, note, reviewed_at
        ) VALUES (
          ${input.tenantId}::uuid,
          ${input.candidateId}::uuid,
          ${input.reviewerMemberId}::uuid,
          ${input.decision},
          'pending_review',
          ${resultingStatus},
          ${input.expectedUpdatedAt},
          ${input.note},
          ${input.reviewedAt}
        )
        RETURNING id
      `;
      const reviewId: string | undefined = reviews[0]?.id;
      if (reviewId === undefined) throw new Error('Failed to save review audit');
      return {
        status: 'reviewed',
        candidate: this.mapCandidate(updated),
        reviewId,
      };
    });
  }

  private mapCandidate(row: CandidateRow): PlaybookOptimizationCandidate {
    return {
      id: row.id,
      topicPreview: row.topic_preview,
      lastQaStatus: row.last_qa_status,
      occurrenceCount: row.occurrence_count,
      reasons: parseReasons(row.reasons),
      sources: parseSources(row.source_refs),
      status: row.status,
      firstObservedAt: toDate(row.first_observed_at).toISOString(),
      lastObservedAt: toDate(row.last_observed_at).toISOString(),
      updatedAt: toDate(row.updated_at).toISOString(),
    };
  }
}

export {
  PostgresPlaybookOptimizationRepository,
  parseReasons,
  parseSources,
  revisionChanged,
};
