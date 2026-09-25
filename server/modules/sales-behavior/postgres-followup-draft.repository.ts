import { Inject, Injectable } from '@nestjs/common';

import type { Sql } from 'postgres';
import type {
  FollowupDraft,
  FollowupProgressSnapshot,
  SalesContext,
} from '@shared/api.interface';
import {
  AGENT_DATABASE,
} from '@server/modules/control-store/postgres-control.store';
import {
  parseFollowupDraft,
  parseProgressAssessment,
  parseSalesContext,
} from '@server/modules/agent-core/agent.validation';
import type {
  AppendDraftEditInput,
  CreateDraftRecordInput,
  FollowupDraftCreationKind,
  FollowupDraftRecord,
  FollowupDraftRepository,
  FollowupDraftStatus,
  FollowupDraftVersionRecord,
  FollowupSourceType,
} from './followup-draft.repository';
import type { FollowupQualityResult } from './sales-behavior.types';

interface IdRow {
  id: string;
}

interface DraftRow {
  id: string;
  tenant_id: string;
  owner_member_id: string;
  source_type: FollowupSourceType;
  status: FollowupDraftStatus;
  current_version: number;
  version: number;
  creation_kind: FollowupDraftCreationKind;
  source_text: string;
  generated_body: string;
  structured_fields: unknown;
  context_snapshot: unknown;
  progress_assessment: unknown;
  quality_snapshot: unknown;
  created_at: Date | string;
}

const toDate = (value: Date | string): Date =>
  value instanceof Date ? value : new Date(value);

const parseQuality = (value: unknown): FollowupQualityResult => {
  if (typeof value !== 'object' || value === null) {
    throw new Error('Invalid stored followup quality snapshot');
  }
  return value as FollowupQualityResult;
};

@Injectable()
class PostgresFollowupDraftRepository
implements FollowupDraftRepository {
  constructor(
    @Inject(AGENT_DATABASE)
    private readonly sql: Sql,
  ) {}

  async createGeneratedDraft(
    input: CreateDraftRecordInput,
  ): Promise<FollowupDraftRecord> {
    const draftId: string = await this.sql.begin(async (tx): Promise<string> => {
      const jobRows: IdRow[] = await tx<IdRow[]>`
          INSERT INTO followup_input_jobs (
            tenant_id, actor_member_id, source_type, source_text,
            status, idempotency_key
          ) VALUES (
            ${input.tenantId}::uuid,
            ${input.ownerMemberId}::uuid,
            ${input.sourceType},
            ${input.sourceText},
            'pending_confirmation',
            ${input.idempotencyKey}
          )
          ON CONFLICT (tenant_id, actor_member_id, idempotency_key)
          DO UPDATE SET updated_at = followup_input_jobs.updated_at
          RETURNING id
      `;
      const jobId: string | undefined = jobRows[0]?.id;
      if (jobId === undefined) {
        throw new Error('Failed to create followup input job');
      }
      const draftRows: IdRow[] = await tx<IdRow[]>`
          INSERT INTO followup_drafts (
            tenant_id, input_job_id, owner_member_id,
            source_type, status, current_version
          ) VALUES (
            ${input.tenantId}::uuid,
            ${jobId}::uuid,
            ${input.ownerMemberId}::uuid,
            ${input.sourceType},
            'pendingConfirmation',
            1
          )
          ON CONFLICT (tenant_id, input_job_id)
          DO UPDATE SET updated_at = followup_drafts.updated_at
          RETURNING id
      `;
      const id: string | undefined = draftRows[0]?.id;
      if (id === undefined) {
        throw new Error('Failed to create followup draft');
      }
      await tx`
        INSERT INTO followup_draft_versions (
          tenant_id, draft_id, version, creation_kind,
          source_text, generated_body, structured_fields,
          context_snapshot, progress_assessment, evidence,
          quality_snapshot, created_at
        ) VALUES (
          ${input.tenantId}::uuid,
          ${id}::uuid,
          1,
          'generated',
          ${input.sourceText},
          ${input.generatedBody},
          ${JSON.stringify(input.draft)}::text::jsonb,
          ${input.salesContext === undefined
            ? null
            : JSON.stringify(input.salesContext)}::text::jsonb,
          ${input.progressAssessment === undefined
            ? null
            : JSON.stringify(input.progressAssessment)}::text::jsonb,
          ${JSON.stringify(input.draft.evidenceQuotes)}::text::jsonb,
          ${JSON.stringify(input.quality)}::text::jsonb,
          ${input.createdAt}
        )
        ON CONFLICT (tenant_id, draft_id, version) DO NOTHING
      `;
      return id;
    });
    const record: FollowupDraftRecord | null =
      await this.getDraft(input.tenantId, draftId);
    if (record === null) {
      throw new Error('Created followup draft could not be read');
    }
    return record;
  }

  async getDraft(
    tenantId: string,
    draftId: string,
  ): Promise<FollowupDraftRecord | null> {
    const rows: DraftRow[] = await this.sql<DraftRow[]>`
      SELECT
        draft.id,
        draft.tenant_id,
        draft.owner_member_id,
        draft.source_type,
        draft.status,
        draft.current_version,
        version.version,
        version.creation_kind,
        version.source_text,
        version.generated_body,
        version.structured_fields,
        version.context_snapshot,
        version.progress_assessment,
        version.quality_snapshot,
        version.created_at
      FROM followup_drafts AS draft
      INNER JOIN followup_draft_versions AS version
        ON version.tenant_id = draft.tenant_id
        AND version.draft_id = draft.id
        AND version.version = draft.current_version
      WHERE draft.tenant_id = ${tenantId}::uuid
        AND draft.id = ${draftId}::uuid
      LIMIT 1
    `;
    return rows[0] === undefined ? null : this.mapDraft(rows[0]);
  }

  async appendUserEdit(
    input: AppendDraftEditInput,
  ): Promise<FollowupDraftRecord | null> {
    const updated: boolean = await this.sql.begin(
      async (tx): Promise<boolean> => {
        const rows = await tx<{ current_version: number }[]>`
          UPDATE followup_drafts
          SET
            current_version = current_version + 1,
            updated_at = ${input.createdAt}
          WHERE tenant_id = ${input.tenantId}::uuid
            AND id = ${input.draftId}::uuid
            AND owner_member_id = ${input.ownerMemberId}::uuid
            AND status = 'pendingConfirmation'
            AND current_version = ${input.expectedVersion}
          RETURNING current_version
        `;
        const version: number | undefined = rows[0]?.current_version;
        if (version === undefined) {
          return false;
        }
        await tx`
          INSERT INTO followup_draft_versions (
            tenant_id, draft_id, version, creation_kind,
            source_text, generated_body, structured_fields,
            context_snapshot, progress_assessment, evidence,
            quality_snapshot, created_at
          )
          SELECT
            ${input.tenantId}::uuid,
            ${input.draftId}::uuid,
            ${version},
            'user_edit',
            previous.source_text,
            ${input.generatedBody},
            ${JSON.stringify(input.draft)}::text::jsonb,
            previous.context_snapshot,
            COALESCE(
              ${input.progressAssessment === undefined
                ? null
                : JSON.stringify(input.progressAssessment)}::text::jsonb,
              previous.progress_assessment
            ),
            ${JSON.stringify(input.draft.evidenceQuotes)}::text::jsonb,
            ${JSON.stringify(input.quality)}::text::jsonb,
            ${input.createdAt}
          FROM followup_draft_versions AS previous
          WHERE previous.tenant_id = ${input.tenantId}::uuid
            AND previous.draft_id = ${input.draftId}::uuid
            AND previous.version = ${input.expectedVersion}
        `;
        return true;
      },
    );
    return updated
      ? this.getDraft(input.tenantId, input.draftId)
      : null;
  }

  async markConfirmed(input: {
    tenantId: string;
    draftId: string;
    ownerMemberId: string;
    expectedVersion: number;
    confirmedAt: Date;
  }): Promise<FollowupDraftRecord | null> {
    const updated: boolean = await this.sql.begin(
      async (tx): Promise<boolean> => {
        const rows = await tx<{ current_version: number }[]>`
          UPDATE followup_drafts
          SET
            status = 'confirmed',
            current_version = current_version + 1,
            updated_at = ${input.confirmedAt}
          WHERE tenant_id = ${input.tenantId}::uuid
            AND id = ${input.draftId}::uuid
            AND owner_member_id = ${input.ownerMemberId}::uuid
            AND status = 'pendingConfirmation'
            AND current_version = ${input.expectedVersion}
          RETURNING current_version
        `;
        const version: number | undefined = rows[0]?.current_version;
        if (version === undefined) return false;
        await tx`
          INSERT INTO followup_draft_versions (
            tenant_id, draft_id, version, creation_kind,
            source_text, generated_body, structured_fields, context_snapshot,
            progress_assessment, evidence, quality_snapshot, llm_model,
            prompt_version, schema_version, confirmed_at, created_at
          )
          SELECT
            previous.tenant_id,
            previous.draft_id,
            ${version},
            'confirmed',
            previous.source_text,
            previous.generated_body,
            previous.structured_fields,
            previous.context_snapshot,
            previous.progress_assessment,
            previous.evidence,
            previous.quality_snapshot,
            previous.llm_model,
            previous.prompt_version,
            previous.schema_version,
            ${input.confirmedAt},
            ${input.confirmedAt}
          FROM followup_draft_versions AS previous
          WHERE previous.tenant_id = ${input.tenantId}::uuid
            AND previous.draft_id = ${input.draftId}::uuid
            AND previous.version = ${input.expectedVersion}
        `;
        return true;
      },
    );
    return updated ? this.getDraft(input.tenantId, input.draftId) : null;
  }

  private mapDraft(row: DraftRow): FollowupDraftRecord {
    const draft: FollowupDraft = parseFollowupDraft(row.structured_fields);
    const salesContext: SalesContext | undefined =
      row.context_snapshot === null || row.context_snapshot === undefined
        ? undefined
        : parseSalesContext(row.context_snapshot);
    const progressAssessment: FollowupProgressSnapshot | undefined =
      row.progress_assessment === null || row.progress_assessment === undefined
        ? undefined
        : parseProgressAssessment(row.progress_assessment);
    const version: FollowupDraftVersionRecord = {
      tenantId: row.tenant_id,
      draftId: row.id,
      version: row.version,
      creationKind: row.creation_kind,
      sourceText: row.source_text,
      generatedBody: row.generated_body,
      draft,
      salesContext,
      progressAssessment,
      quality: parseQuality(row.quality_snapshot),
      createdAt: toDate(row.created_at),
    };
    return {
      id: row.id,
      tenantId: row.tenant_id,
      ownerMemberId: row.owner_member_id,
      sourceType: row.source_type,
      status: row.status,
      currentVersion: row.current_version,
      version,
    };
  }
}

export { PostgresFollowupDraftRepository };
