import {
  Inject,
  Injectable,
  Logger,
} from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { parsePreparationContext } from '@server/modules/insight/customer-preparation-context';
import { parsePreparationDraftEdit } from '@server/modules/insight/preparation-draft-edit';

import type { Sql } from 'postgres';
import type {
  AgentExecutionResult,
  CustomerPreparationResultSnapshot,
  CustomerPreparationDeliveryStatus,
  AgentSessionState,
  PendingActionStatus,
  TaskFulfillmentChange,
} from '@shared/api.interface';
import type { ControlStore } from '@server/modules/agent-core/agent.ports';
import type { ConfirmPreparationDeliveryInput, PreparationDeliveryClaim, PreparationDeliveryLease, PreparationDeliveryFinish } from '@server/modules/agent-core/preparation-delivery.types';
import type {
  AgentSession,
  CompletePreparationSessionInput,
  SavePreparationDraftInput,
  AuditEventInput,
  CreatePendingActionInput,
  PendingAction,
  SaveCollectingSessionInput,
  SaveIntentClarificationSessionInput,
  SavePreparationClarificationSessionInput,
  TaskStatusEvent,
  TaskStatusEventResult,
  TenantIntegration,
  TaskStatusSnapshot,
  TaskEventReceiptInput,
} from '@server/modules/agent-core/agent.types';
import {
  parseAgentExecutionResult,
  parseFollowupDraft,
  parsePendingActionPayload,
  parseTenantBaseMapping,
} from '@server/modules/agent-core/agent.validation';

interface IntegrationRow {
  tenant_id: string;
  feishu_tenant_key: string;
  name: string;
  status: 'active' | 'disabled';
  app_id: string;
  app_secret_env: string;
  app_type: 'selfBuild' | 'isv';
  base_mapping: unknown;
}

interface SessionRow {
  revision?: number;
  preparation_context?: unknown;
  id: string;
  tenant_id: string;
  actor_open_id: string;
  chat_id: string;
  state: AgentSessionState;
  source_message_id: string;
  raw_text: string;
  draft: unknown;
  expires_at: Date | string;
  created_at: Date | string;
  updated_at: Date | string;
}

interface PendingActionRow {
  id: string;
  tenant_id: string;
  actor_open_id: string;
  chat_id: string;
  card_message_id: string | null;
  status: PendingActionStatus;
  payload: unknown;
  result: unknown;
  expires_at: Date | string;
  created_at: Date | string;
  updated_at: Date | string;
}

interface TaskSnapshotRow {
  task_guid: string;
  title: string;
  status: string;
  completed_at: Date | string | null;
  due_at: Date | string | null;
  task_url: string | null;
}

interface TaskStatusEventRow {
  event_id: string;
  task_guid: string;
  event_kind: TaskStatusEvent['kind'];
  title: string;
  status: string;
  completed_at: Date | string | null;
  due_at: Date | string | null;
  task_url: string | null;
  occurred_at: Date | string;
  previous_title: string | null;
  previous_status: string | null;
  previous_completed_at: Date | string | null;
  previous_due_at: Date | string | null;
  related_task_guid: string | null;
  relation: 'replaces' | null;
}

interface TaskEventReceiptRow {
  event_id: string;
}

interface IdRow {
  id: string;
}

export const AGENT_DATABASE = Symbol('AGENT_DATABASE');

@Injectable()
export class PostgresControlStore
  implements ControlStore
{
  private readonly logger: Logger = new Logger(PostgresControlStore.name);

  constructor(
    @Inject(AGENT_DATABASE)
    private readonly sql: Sql,
  ) {}

  async resolveTenant(
    feishuTenantKey: string,
  ): Promise<TenantIntegration | null> {
    const rows: IntegrationRow[] = await this.sql<IntegrationRow[]>`
      SELECT
        tenant.id AS tenant_id,
        tenant.feishu_tenant_key,
        tenant.name,
        tenant.status,
        integration.app_id,
        integration.app_secret_env,
        integration.app_type,
        integration.base_mapping
      FROM agent_tenants AS tenant
      INNER JOIN tenant_integrations AS integration
        ON integration.tenant_id = tenant.id
      WHERE tenant.feishu_tenant_key = ${feishuTenantKey}
        AND integration.enabled = true
      LIMIT 1
    `;
    return this.mapIntegration(rows[0]);
  }

  async resolveTenantById(
    tenantId: string,
  ): Promise<TenantIntegration | null> {
    const rows: IntegrationRow[] = await this.sql<IntegrationRow[]>`
      SELECT
        tenant.id AS tenant_id,
        tenant.feishu_tenant_key,
        tenant.name,
        tenant.status,
        integration.app_id,
        integration.app_secret_env,
        integration.app_type,
        integration.base_mapping
      FROM agent_tenants AS tenant
      INNER JOIN tenant_integrations AS integration
        ON integration.tenant_id = tenant.id
      WHERE tenant.id = ${tenantId}::uuid
        AND integration.enabled = true
      LIMIT 1
    `;
    return this.mapIntegration(rows[0]);
  }

  async listActiveIntegrations(): Promise<TenantIntegration[]> {
    const rows: IntegrationRow[] = await this.sql<IntegrationRow[]>`
      SELECT
        tenant.id AS tenant_id,
        tenant.feishu_tenant_key,
        tenant.name,
        tenant.status,
        integration.app_id,
        integration.app_secret_env,
        integration.app_type,
        integration.base_mapping
      FROM agent_tenants AS tenant
      INNER JOIN tenant_integrations AS integration
        ON integration.tenant_id = tenant.id
      WHERE tenant.status = 'active'
        AND integration.enabled = true
      ORDER BY tenant.id ASC
    `;
    const integrations: TenantIntegration[] = [];
    for (const row of rows) {
      const integration: TenantIntegration | null =
        this.mapIntegration(row);
      if (integration !== null) {
        integrations.push(integration);
      }
    }
    return integrations;
  }

  async claimMessage(
    tenantId: string,
    messageId: string,
  ): Promise<boolean> {
    const rows: IdRow[] = await this.sql<IdRow[]>`
      INSERT INTO processed_messages (tenant_id, message_id)
      VALUES (${tenantId}, ${messageId})
      ON CONFLICT (tenant_id, message_id) DO NOTHING
      RETURNING message_id AS id
    `;
    return rows.length === 1;
  }

  async getOpenSession(
    tenantId: string,
    actorOpenId: string,
  ): Promise<AgentSession | null> {
    const rows: SessionRow[] = await this.sql<SessionRow[]>`
      SELECT
        id,
        tenant_id,
        actor_open_id,
        chat_id,
        state,
        source_message_id,
        raw_text,
        draft,
        expires_at,
        created_at,
        updated_at
      FROM agent_sessions
      WHERE tenant_id = ${tenantId}
        AND actor_open_id = ${actorOpenId}
        AND state = 'collecting'
        AND expires_at > CURRENT_TIMESTAMP
      LIMIT 1
    `;
    const row: SessionRow | undefined = rows[0];
    return row ? this.mapSession(row) : null;
  }

  async saveCollectingSession(
    input: SaveCollectingSessionInput,
  ): Promise<AgentSession> {
    const draftJson: string = JSON.stringify(input.draft);
    const rows: SessionRow[] = await this.sql<SessionRow[]>`
      INSERT INTO agent_sessions (
        tenant_id,
        actor_open_id,
        chat_id,
        state,
        source_message_id,
        raw_text,
        draft,
        expires_at
      )
      VALUES (
        ${input.tenantId},
        ${input.actorOpenId},
        ${input.chatId},
        'collecting',
        ${input.sourceMessageId},
        ${input.rawText},
        ${draftJson}::text::jsonb,
        ${input.expiresAt}
      )
      ON CONFLICT (tenant_id, actor_open_id) DO UPDATE SET
        chat_id = EXCLUDED.chat_id,
        state = 'collecting',
        source_message_id = EXCLUDED.source_message_id,
        raw_text = EXCLUDED.raw_text,
        draft = EXCLUDED.draft,
        expires_at = EXCLUDED.expires_at,
        updated_at = CURRENT_TIMESTAMP
      RETURNING
        id,
        tenant_id,
        actor_open_id,
        chat_id,
        state,
        source_message_id,
        raw_text,
        draft,
        expires_at,
        created_at,
        updated_at
    `;
    return this.requireSessionRow(rows);
  }

  async saveIntentClarificationSession(
    input: SaveIntentClarificationSessionInput,
  ): Promise<AgentSession> {
    const rows: SessionRow[] = await this.sql<SessionRow[]>`
      INSERT INTO agent_sessions (
        tenant_id,
        actor_open_id,
        chat_id,
        state,
        source_message_id,
        raw_text,
        draft,
        expires_at
      )
      VALUES (
        ${input.tenantId},
        ${input.actorOpenId},
        ${input.chatId},
        'collecting',
        ${input.sourceMessageId},
        ${input.rawText},
        NULL,
        ${input.expiresAt}
      )
      ON CONFLICT (tenant_id, actor_open_id) DO UPDATE SET
        chat_id = EXCLUDED.chat_id,
        state = 'collecting',
        source_message_id = EXCLUDED.source_message_id,
        raw_text = EXCLUDED.raw_text,
        draft = NULL,
        expires_at = EXCLUDED.expires_at,
        updated_at = CURRENT_TIMESTAMP
      RETURNING
        id,
        tenant_id,
        actor_open_id,
        chat_id,
        state,
        source_message_id,
        raw_text,
        draft,
        expires_at,
        created_at,
        updated_at
    `;
    return this.requireSessionRow(rows);
  }

  async getOpenPreparationSession(
    tenantId: string,
    actorOpenId: string,
    chatId: string,
    includeInactive: boolean = false,
  ): Promise<AgentSession | null> {
    const rows: SessionRow[] = await this.sql<SessionRow[]>`
      SELECT revision, preparation_context, id, tenant_id, actor_open_id, chat_id, state,
        source_message_id, raw_text, draft, expires_at, created_at, updated_at
      FROM preparation_sessions
      WHERE tenant_id = ${tenantId} AND actor_open_id = ${actorOpenId}
        AND chat_id = ${chatId}
        AND (${includeInactive} OR
          (state = 'preparation_clarifying' AND expires_at > CURRENT_TIMESTAMP))
      LIMIT 1
    `;
    const row: SessionRow | undefined = rows[0];
    return row ? this.mapSession(row) : null;
  }

  async completePreparationSession(input: CompletePreparationSessionInput): Promise<CustomerPreparationResultSnapshot | null> {
    const rows = await this.sql<Array<{
      id: string; request: CustomerPreparationResultSnapshot['request'];
      report: CustomerPreparationResultSnapshot['report']; revision: number; created_at: Date;
      draft_edits: CustomerPreparationResultSnapshot['draftEdits']; updated_at: Date;
    }>>`
      WITH completed AS (
        UPDATE preparation_sessions
        SET state = 'closed', revision = revision + 1, updated_at = CURRENT_TIMESTAMP
        WHERE tenant_id = ${input.tenantId} AND actor_open_id = ${input.actorOpenId}
          AND chat_id = ${input.chatId} AND revision = ${input.expectedRevision}
          AND state = 'preparation_clarifying' AND expires_at > CURRENT_TIMESTAMP
        RETURNING tenant_id, actor_open_id, source_message_id
      )
      , saved AS (
      INSERT INTO preparation_results (tenant_id, actor_open_id, source_message_id, request, report)
      SELECT tenant_id, actor_open_id, source_message_id,
        ${JSON.stringify(input.request)}::text::jsonb, ${JSON.stringify(input.report)}::text::jsonb
      FROM completed
      RETURNING id, request, report, revision, created_at, draft_edits, updated_at
      ), delivery AS (
        INSERT INTO preparation_result_deliveries (result_id, chat_id)
        SELECT id, ${input.chatId} FROM saved RETURNING result_id
      )
      SELECT saved.* FROM saved JOIN delivery ON delivery.result_id = saved.id
    `;
    const row = rows[0];
    return row ? { id: row.id, request: row.request, report: row.report,
      revision: row.revision, createdAt: row.created_at.toISOString(),
      draftEdits: row.draft_edits, updatedAt: row.updated_at.toISOString() } : null;
  }

  async getPreparationResult(tenantId: string, actorOpenId: string, id: string): Promise<CustomerPreparationResultSnapshot | null> {
    const rows = await this.sql<Array<{
      id: string; request: CustomerPreparationResultSnapshot['request'];
      report: CustomerPreparationResultSnapshot['report']; revision: number; created_at: Date;
      draft_edits: CustomerPreparationResultSnapshot['draftEdits']; updated_at: Date;
    }>>`
      SELECT id, request, report, revision, created_at, draft_edits, updated_at FROM preparation_results
      WHERE tenant_id = ${tenantId} AND actor_open_id = ${actorOpenId} AND id = ${id}
    `;
    const row = rows[0];
    return row ? { id: row.id, request: row.request, report: row.report,
      revision: row.revision, createdAt: row.created_at.toISOString(),
      draftEdits: row.draft_edits, updatedAt: row.updated_at.toISOString() } : null;
  }

  async claimPreparationDelivery(input: PreparationDeliveryClaim): Promise<PreparationDeliveryLease | null> {
    const token: string = randomUUID();
    const expiredAt: Date = new Date(input.now.getTime() - 300000);
    const rows = await this.sql<Array<{ status: string; claim_token: string; chat_id: string; frozen_text: string }>>`
      UPDATE preparation_result_deliveries AS delivery
      SET status = CASE WHEN delivery.status = 'pending' THEN 'dispatching' ELSE 'unknown' END,
        frozen_text = COALESCE(delivery.frozen_text, ${input.text}),
        claim_token = CASE WHEN delivery.status = 'pending' THEN ${token}::uuid ELSE delivery.claim_token END,
        started_at = CASE WHEN delivery.status = 'pending' THEN ${input.now} ELSE delivery.started_at END,
        updated_at = CURRENT_TIMESTAMP
      FROM preparation_results AS result
      WHERE delivery.result_id = result.id AND result.id = ${input.resultId}
        AND result.tenant_id = ${input.tenantId} AND result.actor_open_id = ${input.actorOpenId}
        AND (delivery.status = 'pending' OR (delivery.status = 'dispatching' AND delivery.started_at <= ${expiredAt}))
      RETURNING delivery.status, delivery.claim_token, delivery.chat_id, delivery.frozen_text
    `;
    const row = rows[0];
    return row?.status === 'dispatching'
      ? { token: row.claim_token, chatId: row.chat_id, text: row.frozen_text } : null;
  }

  async getPreparationDelivery(input: { tenantId: string; actorOpenId: string; resultId: string }): Promise<CustomerPreparationDeliveryStatus | null> {
    const rows = await this.sql<CustomerPreparationDeliveryStatus[]>`
      SELECT delivery.status, delivery.updated_at AS "updatedAt",
        delivery.reconciliation_version AS "reconciliationVersion" FROM preparation_result_deliveries AS delivery
      JOIN preparation_results AS result ON result.id = delivery.result_id
      WHERE result.id = ${input.resultId} AND result.tenant_id = ${input.tenantId}
        AND result.actor_open_id = ${input.actorOpenId}
    `;
    return rows[0] ? { status: rows[0].status, updatedAt: new Date(rows[0].updatedAt).toISOString(),
      reconciliationVersion: rows[0].reconciliationVersion } : null;
  }

  async confirmPreparationDelivery(input: ConfirmPreparationDeliveryInput): Promise<boolean> {
    const rows = await this.sql`
      WITH current_delivery AS (
        SELECT delivery.result_id, result.tenant_id, result.actor_open_id
        FROM preparation_result_deliveries AS delivery
        JOIN preparation_results AS result ON result.id = delivery.result_id
        WHERE result.id = ${input.resultId} AND result.tenant_id = ${input.tenantId}
          AND result.actor_open_id = ${input.actorOpenId} AND delivery.status = 'unknown'
          AND delivery.reconciliation_version = 1
          AND delivery.reconciliation_version = ${input.expectedVersion}
          AND EXISTS (SELECT 1 FROM tenant_members AS member WHERE member.tenant_id = result.tenant_id
            AND member.feishu_open_id = ${input.operatorOpenId} AND member.status = 'active')
        FOR UPDATE OF delivery
      ), updated AS (
        UPDATE preparation_result_deliveries AS delivery
        SET status = 'sent', message_id = ${input.messageId}, updated_at = ${input.now},
          reconciliation_version = reconciliation_version + 1
        FROM current_delivery
        WHERE delivery.result_id = current_delivery.result_id
        RETURNING current_delivery.result_id, current_delivery.tenant_id, current_delivery.actor_open_id
      ), audited AS (
        INSERT INTO preparation_result_delivery_reconciliations (
          result_id, tenant_id, actor_open_id, operator_member_id, decision,
          expected_version, note, evidence_message_id, evidence_sent_at, reconciled_at
        )
        SELECT updated.result_id, updated.tenant_id, updated.actor_open_id, member.id,
          'confirm_sent', 1, ${input.note}, ${input.messageId}, ${input.sentAt}, ${input.now}
        FROM updated
        JOIN tenant_members AS member ON member.tenant_id = updated.tenant_id
          AND member.feishu_open_id = ${input.operatorOpenId} AND member.status = 'active'
        RETURNING result_id
      ) SELECT result_id FROM audited
    `;
    return rows.length === 1;
  }

  async finishPreparationDelivery(input: PreparationDeliveryFinish): Promise<boolean> {
    const status: string = input.messageId ? 'sent' : 'unknown';
    const rows = await this.sql`
      WITH updated AS (
        UPDATE preparation_result_deliveries AS delivery
        SET status = ${status}, message_id = ${input.messageId}, updated_at = CURRENT_TIMESTAMP
        FROM preparation_results AS result
        WHERE delivery.result_id = result.id AND result.id = ${input.resultId}
          AND result.tenant_id = ${input.tenantId} AND result.actor_open_id = ${input.actorOpenId}
          AND delivery.status = 'dispatching' AND delivery.claim_token = ${input.token}::uuid
        RETURNING result.tenant_id, result.actor_open_id, result.id
      )
      INSERT INTO audit_events (tenant_id, actor_open_id, trace_id, event_type, entity_id, outcome, details)
      SELECT tenant_id, actor_open_id, ${input.token}, 'preparation.delivery_finished', id,
        ${input.messageId ? 'succeeded' : 'failed'},
        jsonb_build_object('status', ${status}::text) FROM updated RETURNING id
    `;
    return rows.length === 1;
  }

  async savePreparationDraft(input: SavePreparationDraftInput): Promise<CustomerPreparationResultSnapshot | null> {
    const edit = parsePreparationDraftEdit(input.edit);
    const draftJson: string = JSON.stringify({ channel: edit.channel, subject: edit.subject, body: edit.body });
    const rows = await this.sql<Array<{
      id: string; request: CustomerPreparationResultSnapshot['request'];
      report: CustomerPreparationResultSnapshot['report']; revision: number; created_at: Date;
      draft_edits: CustomerPreparationResultSnapshot['draftEdits']; updated_at: Date;
    }>>`
      WITH updated AS (
        UPDATE preparation_results AS result
        SET draft_edits = (
          SELECT COALESCE(jsonb_agg(draft), '[]'::jsonb)
          FROM jsonb_array_elements(result.draft_edits) AS draft
          WHERE draft->>'channel' <> ${edit.channel}
        ) || jsonb_build_array(${draftJson}::text::jsonb),
        revision = revision + 1, updated_at = CURRENT_TIMESTAMP
        WHERE tenant_id = ${input.tenantId} AND actor_open_id = ${input.actorOpenId}
          AND id = ${input.id} AND revision = ${edit.expectedRevision}
          AND EXISTS (SELECT 1 FROM jsonb_array_elements(report->'drafts') AS draft
            WHERE draft->>'channel' = ${edit.channel})
        RETURNING *
      ), audited AS (
        INSERT INTO audit_events (tenant_id, trace_id, event_type, actor_open_id, entity_id, outcome, details)
        SELECT tenant_id, ${randomUUID()}, 'preparation.draft_saved', actor_open_id, id::text, 'succeeded',
          jsonb_build_object('channel', ${edit.channel}::text, 'revision', revision)
        FROM updated RETURNING id
      )
      SELECT updated.id, request, report, revision, updated.created_at, draft_edits, updated_at
      FROM updated CROSS JOIN audited
    `;
    const row = rows[0];
    return row ? { id: row.id, request: row.request, report: row.report,
      revision: row.revision, createdAt: row.created_at.toISOString(),
      draftEdits: row.draft_edits, updatedAt: row.updated_at.toISOString() } : null;
  }

  async savePreparationClarificationSession(
    input: SavePreparationClarificationSessionInput,
  ): Promise<AgentSession> {
    const preparationContext = parsePreparationContext(input.preparationContext, input.rawText);
    const contextJson: string = JSON.stringify(preparationContext);
    const expectedRevision: number | null = input.expectedRevision ?? null;
    const rows: SessionRow[] = await this.sql<SessionRow[]>`
      INSERT INTO preparation_sessions (
        tenant_id, actor_open_id, chat_id, state, source_message_id,
        raw_text, draft, expires_at, preparation_context
      ) SELECT
        ${input.tenantId}, ${input.actorOpenId}, ${input.chatId},
        'preparation_clarifying', ${input.sourceMessageId}, ${input.rawText},
        NULL, ${input.expiresAt}, ${contextJson}::text::jsonb
      WHERE ${expectedRevision}::integer IS NULL OR ${expectedRevision}::integer = 0
        OR EXISTS (SELECT 1 FROM preparation_sessions
          WHERE tenant_id = ${input.tenantId} AND actor_open_id = ${input.actorOpenId}
            AND chat_id = ${input.chatId} AND revision = ${expectedRevision})
      ON CONFLICT (tenant_id, actor_open_id, chat_id) DO UPDATE SET
        chat_id = EXCLUDED.chat_id, state = 'preparation_clarifying',
        source_message_id = EXCLUDED.source_message_id,
        raw_text = EXCLUDED.raw_text, draft = NULL,
        preparation_context = EXCLUDED.preparation_context,
        revision = preparation_sessions.revision + 1,
        expires_at = EXCLUDED.expires_at, updated_at = CURRENT_TIMESTAMP
      WHERE ${expectedRevision}::integer IS NULL OR preparation_sessions.revision = ${expectedRevision}
      RETURNING revision, preparation_context, id, tenant_id, actor_open_id, chat_id, state,
        source_message_id, raw_text, draft, expires_at, created_at, updated_at
    `;
    if (rows.length === 0) throw new Error('Preparation revision conflict');
    return this.requireSessionRow(rows);
  }

  async closePreparationSession(tenantId: string, actorOpenId: string, chatId: string, expectedRevision?: number): Promise<boolean> {
    const rows = await this.sql`
      UPDATE preparation_sessions SET state = 'closed', revision = revision + 1, updated_at = CURRENT_TIMESTAMP
      WHERE tenant_id = ${tenantId} AND actor_open_id = ${actorOpenId} AND chat_id = ${chatId}
        AND (${expectedRevision ?? null}::integer IS NULL OR
          (revision = ${expectedRevision ?? null} AND state = 'preparation_clarifying'
           AND expires_at > CURRENT_TIMESTAMP))
      RETURNING id
    `;
    return rows.length > 0;
  }

  async closeSession(
    tenantId: string,
    actorOpenId: string,
  ): Promise<void> {
    await this.sql`
      UPDATE agent_sessions
      SET state = 'closed', updated_at = CURRENT_TIMESTAMP
      WHERE tenant_id = ${tenantId}
        AND actor_open_id = ${actorOpenId}
    `;
  }

  async createPendingAction(
    input: CreatePendingActionInput,
  ): Promise<PendingAction> {
    const payloadJson: string = JSON.stringify(input.payload);
    const initialResult: AgentExecutionResult = {
      pendingActionId: input.id,
      status: 'pendingConfirmation',
    };
    const resultJson: string = JSON.stringify(initialResult);
    const rows: PendingActionRow[] =
      await this.sql<PendingActionRow[]>`
        INSERT INTO pending_actions (
          tenant_id,
          id,
          actor_open_id,
          chat_id,
          status,
          payload,
          result,
          expires_at
        )
        VALUES (
          ${input.tenantId},
          ${input.id},
          ${input.actorOpenId},
          ${input.chatId},
          'pendingConfirmation',
          ${payloadJson}::text::jsonb,
          ${resultJson}::text::jsonb,
          ${input.expiresAt}
        )
        ON CONFLICT (tenant_id, id) DO NOTHING
        RETURNING *
      `;
    const inserted: PendingActionRow | undefined = rows[0];
    if (inserted) {
      return this.mapPendingAction(inserted);
    }

    const existing: PendingAction | null = await this.getPendingAction(
      input.tenantId,
      input.id,
    );
    if (!existing) {
      throw new Error('Pending action could not be created');
    }
    return existing;
  }

  async setPendingCardMessage(
    tenantId: string,
    actionId: string,
    messageId: string,
  ): Promise<void> {
    const rows: IdRow[] = await this.sql<IdRow[]>`
      UPDATE pending_actions
      SET card_message_id = ${messageId}, updated_at = CURRENT_TIMESTAMP
      WHERE tenant_id = ${tenantId} AND id = ${actionId}
      RETURNING id
    `;
    if (rows.length !== 1) {
      throw new Error('Pending action not found while saving card message');
    }
  }

  async movePendingCardMessage(
    tenantId: string,
    fromActionId: string,
    toActionId: string,
    actorOpenId: string,
  ): Promise<void> {
    const rows: IdRow[] = await this.sql<IdRow[]>`
      WITH source AS (
        SELECT card_message_id
        FROM pending_actions
        WHERE tenant_id = ${tenantId}
          AND id = ${fromActionId}
          AND actor_open_id = ${actorOpenId}
          AND card_message_id IS NOT NULL
      ), moved AS (
        UPDATE pending_actions
        SET card_message_id = NULL, updated_at = CURRENT_TIMESTAMP
        WHERE tenant_id = ${tenantId}
          AND id = ${fromActionId}
          AND actor_open_id = ${actorOpenId}
          AND card_message_id IS NOT NULL
        RETURNING id
      )
      UPDATE pending_actions AS target
      SET
        card_message_id = (SELECT source.card_message_id FROM source),
        updated_at = CURRENT_TIMESTAMP
      FROM moved
      WHERE target.tenant_id = ${tenantId}
        AND target.id = ${toActionId}
        AND target.actor_open_id = ${actorOpenId}
        AND target.status = 'pendingConfirmation'
        AND target.card_message_id IS NULL
      RETURNING target.id
    `;
    if (rows.length !== 1) {
      throw new Error('Pending action card message could not be moved');
    }
  }

  async rollbackPendingCardRevision(
    tenantId: string,
    revisionActionId: string,
    originalActionId: string,
    actorOpenId: string,
  ): Promise<void> {
    const rows: IdRow[] = await this.sql<IdRow[]>`
      WITH source AS (
        SELECT card_message_id
        FROM pending_actions
        WHERE tenant_id = ${tenantId}
          AND id = ${revisionActionId}
          AND actor_open_id = ${actorOpenId}
          AND status = 'pendingConfirmation'
          AND card_message_id IS NOT NULL
      ), cancelled AS (
        UPDATE pending_actions
        SET
          card_message_id = NULL,
          status = 'cancelled',
          result = jsonb_set(
            CASE
              WHEN jsonb_typeof(result) = 'string'
                THEN (result #>> '{}')::jsonb
              ELSE result
            END,
            '{status}',
            '"cancelled"'::jsonb,
            true
          ),
          updated_at = CURRENT_TIMESTAMP
        WHERE tenant_id = ${tenantId}
          AND id = ${revisionActionId}
          AND actor_open_id = ${actorOpenId}
          AND status = 'pendingConfirmation'
          AND card_message_id IS NOT NULL
        RETURNING id
      )
      UPDATE pending_actions AS original
      SET
        card_message_id = (SELECT source.card_message_id FROM source),
        updated_at = CURRENT_TIMESTAMP
      FROM cancelled
      WHERE original.tenant_id = ${tenantId}
        AND original.id = ${originalActionId}
        AND original.actor_open_id = ${actorOpenId}
        AND original.status IN ('succeeded', 'failed', 'partialFailure')
        AND original.card_message_id IS NULL
      RETURNING original.id
    `;
    if (rows.length !== 1) {
      throw new Error('Pending action card revision could not be rolled back');
    }
  }

  async getPendingAction(
    tenantId: string,
    actionId: string,
  ): Promise<PendingAction | null> {
    const rows: PendingActionRow[] =
      await this.sql<PendingActionRow[]>`
        SELECT *
        FROM pending_actions
        WHERE tenant_id = ${tenantId} AND id = ${actionId}
        LIMIT 1
      `;
    const row: PendingActionRow | undefined = rows[0];
    return row ? this.mapPendingAction(row) : null;
  }

  async getPendingActionByCardMessage(
    tenantId: string,
    cardMessageId: string,
  ): Promise<PendingAction | null> {
    const rows: PendingActionRow[] = await this.sql<PendingActionRow[]>`
      SELECT *
      FROM pending_actions
      WHERE tenant_id = ${tenantId}
        AND card_message_id = ${cardMessageId}
      LIMIT 1
    `;
    const row: PendingActionRow | undefined = rows[0];
    return row ? this.mapPendingAction(row) : null;
  }

  async replacePendingActionPayload(
    tenantId: string,
    actionId: string,
    actorOpenId: string,
    expectedDraftVersion: number,
    expectedInteractionStage: 'input' | 'generating' | 'draft',
    payload: PendingAction['payload'],
    now: Date,
  ): Promise<PendingAction | null> {
    const payloadJson: string = JSON.stringify(payload);
    const rows: PendingActionRow[] = await this.sql<PendingActionRow[]>`
      UPDATE pending_actions
      SET payload = ${payloadJson}::text::jsonb, updated_at = ${now}
      WHERE tenant_id = ${tenantId}
        AND id = ${actionId}
        AND actor_open_id = ${actorOpenId}
        AND status = 'pendingConfirmation'
        AND expires_at > ${now}
        AND COALESCE((payload->>'draftVersion')::integer, 1) =
          ${expectedDraftVersion}
        AND COALESCE(payload->>'interactionStage', 'draft') =
          ${expectedInteractionStage}
      RETURNING *
    `;
    const row: PendingActionRow | undefined = rows[0];
    return row ? this.mapPendingAction(row) : null;
  }

  async acquirePendingAction(
    tenantId: string,
    actionId: string,
    actorOpenId: string,
    allowedStatuses: PendingActionStatus[],
    now: Date,
    payload?: PendingAction['payload'],
    expectedDraftVersion?: number,
  ): Promise<PendingAction | null> {
    const rows: PendingActionRow[] =
      payload === undefined && expectedDraftVersion === undefined
      ? await this.sql<PendingActionRow[]>`
        UPDATE pending_actions
        SET
          status = 'executing',
          result = jsonb_set(
            CASE
              WHEN jsonb_typeof(result) = 'string'
                THEN (result #>> '{}')::jsonb
              ELSE result
            END,
            '{status}',
            '"executing"'::jsonb,
            true
          ),
          updated_at = ${now}
        WHERE tenant_id = ${tenantId}
          AND id = ${actionId}
          AND actor_open_id = ${actorOpenId}
          AND status = ANY(${this.sql.array(allowedStatuses)})
          AND expires_at > ${now}
        RETURNING *
      `
      : await this.acquireWithPayload(
        tenantId,
        actionId,
        actorOpenId,
        allowedStatuses,
        now,
        payload,
        expectedDraftVersion,
      );
    const row: PendingActionRow | undefined = rows[0];
    if (row) {
      return this.mapPendingAction(row);
    }

    await this.expireAction(tenantId, actionId, actorOpenId, now);
    return null;
  }

  private async acquireWithPayload(
    tenantId: string,
    actionId: string,
    actorOpenId: string,
    allowedStatuses: PendingActionStatus[],
    now: Date,
    payload: PendingAction['payload'] | undefined,
    expectedDraftVersion: number | undefined,
  ): Promise<PendingActionRow[]> {
    const payloadJson: string | null = payload === undefined
      ? null
      : JSON.stringify(payload);
    return this.sql<PendingActionRow[]>`
      UPDATE pending_actions
      SET
        status = 'executing',
        payload = CASE
          WHEN ${payloadJson}::text IS NULL THEN payload
          ELSE ${payloadJson}::text::jsonb
        END,
        result = jsonb_set(
          CASE
            WHEN jsonb_typeof(result) = 'string'
              THEN (result #>> '{}')::jsonb
            ELSE result
          END,
          '{status}',
          '"executing"'::jsonb,
          true
        ),
        updated_at = ${now}
      WHERE tenant_id = ${tenantId}
        AND id = ${actionId}
        AND actor_open_id = ${actorOpenId}
        AND status = ANY(${this.sql.array(allowedStatuses)})
        AND expires_at > ${now}
        AND (
          ${expectedDraftVersion ?? null}::integer IS NULL OR
          COALESCE((payload->>'draftVersion')::integer, 1) =
            ${expectedDraftVersion ?? null}
        )
      RETURNING *
    `;
  }

  async cancelPendingAction(
    tenantId: string,
    actionId: string,
    actorOpenId: string,
    now: Date,
  ): Promise<PendingAction | null> {
    const rows: PendingActionRow[] =
      await this.sql<PendingActionRow[]>`
        UPDATE pending_actions
        SET
          status = 'cancelled',
          result = jsonb_set(
            CASE
              WHEN jsonb_typeof(result) = 'string'
                THEN (result #>> '{}')::jsonb
              ELSE result
            END,
            '{status}',
            '"cancelled"'::jsonb,
            true
          ),
          updated_at = ${now}
        WHERE tenant_id = ${tenantId}
          AND id = ${actionId}
          AND actor_open_id = ${actorOpenId}
          AND status = 'pendingConfirmation'
          AND expires_at > ${now}
        RETURNING *
      `;
    const row: PendingActionRow | undefined = rows[0];
    if (row) {
      return this.mapPendingAction(row);
    }

    await this.expireAction(tenantId, actionId, actorOpenId, now);
    return null;
  }

  async saveExecutionResult(
    tenantId: string,
    actionId: string,
    status: PendingActionStatus,
    result: AgentExecutionResult,
  ): Promise<PendingAction> {
    const resultJson: string = JSON.stringify(result);
    const rows: PendingActionRow[] =
      await this.sql<PendingActionRow[]>`
        UPDATE pending_actions
        SET
          status = ${status},
          result = ${resultJson}::text::jsonb,
          updated_at = CURRENT_TIMESTAMP
        WHERE tenant_id = ${tenantId} AND id = ${actionId}
          AND status IN ('executing', 'pendingConfirmation')
        RETURNING *
      `;
    const row: PendingActionRow | undefined = rows[0];
    if (row) {
      return this.mapPendingAction(row);
    }
    const current: PendingAction | null = await this.getPendingAction(
      tenantId,
      actionId,
    );
    if (!current) {
      throw new Error('Pending action not found while saving execution result');
    }
    return current;
  }

  async listSucceededActions(
    tenantId: string,
    actorOpenId: string,
    since: Date,
    limit: number,
  ): Promise<PendingAction[]> {
    const safeLimit: number = Math.min(Math.max(limit, 1), 500);
    const rows: PendingActionRow[] = await this.sql<PendingActionRow[]>`
      SELECT *
      FROM pending_actions
      WHERE tenant_id = ${tenantId}
        AND actor_open_id = ${actorOpenId}
        AND status = 'succeeded'
        AND updated_at >= ${since}
      ORDER BY updated_at DESC
      LIMIT ${safeLimit}
    `;
    return rows.map(
      (row: PendingActionRow): PendingAction => this.mapPendingAction(row),
    );
  }

  async recordTaskEventReceipt(
    input: TaskEventReceiptInput,
  ): Promise<boolean> {
    const eventTypesJson: string = JSON.stringify(input.eventTypes);
    const rows: TaskEventReceiptRow[] = await this.sql<TaskEventReceiptRow[]>`
      INSERT INTO task_event_receipts (
        tenant_id,
        event_id,
        task_guid,
        event_types,
        occurred_at,
        received_at,
        receipt_status,
        payload_hash
      ) VALUES (
        ${input.tenantId}::uuid,
        ${input.eventId},
        ${input.taskGuid},
        ${eventTypesJson}::text::jsonb,
        ${input.occurredAt},
        ${input.receivedAt},
        ${input.receiptStatus},
        ${input.payloadHash}
      )
      ON CONFLICT (tenant_id, event_id) DO NOTHING
      RETURNING event_id
    `;
    return rows.length === 1;
  }

  async recordTaskSnapshots(
    tenantId: string,
    actorOpenId: string,
    observedAt: Date,
    snapshots: TaskStatusSnapshot[],
  ): Promise<TaskFulfillmentChange[]> {
    const changes: TaskFulfillmentChange[] = [];
    for (const snapshot of snapshots) {
      const previousRows: TaskSnapshotRow[] =
        await this.sql<TaskSnapshotRow[]>`
          SELECT task_guid, title, status, completed_at, due_at, task_url
          FROM task_status_snapshots
          WHERE tenant_id = ${tenantId}::uuid
            AND actor_open_id = ${actorOpenId}
            AND task_guid = ${snapshot.guid}
          LIMIT 1
        `;
      const previous: TaskStatusSnapshot | null = previousRows[0]
        ? this.mapTaskSnapshot(previousRows[0])
        : null;
      if (!previous) {
        await this.insertTaskStatusEvent(
          tenantId,
          actorOpenId,
          this.toTaskStatusEvent(snapshot, observedAt, 'observed', null),
        );
      } else if (this.taskSnapshotChanged(previous, snapshot)) {
        const kind: TaskFulfillmentChange['kind'] =
          previous.completedAt === null && snapshot.completedAt !== null
            ? 'completed'
            : previous.completedAt !== null && snapshot.completedAt === null
              ? 'reopened'
              : 'changed';
        await this.insertTaskStatusEvent(
          tenantId,
          actorOpenId,
          this.toTaskStatusEvent(snapshot, observedAt, kind, previous),
        );
        changes.push({
          guid: snapshot.guid,
          title: snapshot.title,
          kind,
          previousTitle: previous.title,
          currentTitle: snapshot.title,
          previousStatus: previous.status,
          currentStatus: snapshot.status,
          previousCompletedAt: previous.completedAt,
          currentCompletedAt: snapshot.completedAt,
          previousDueAt: previous.dueAt,
          currentDueAt: snapshot.dueAt,
          observedAt: observedAt.toISOString(),
        });
      }
      await this.sql`
        INSERT INTO task_status_snapshots (
          tenant_id, actor_open_id, task_guid, title, status,
          completed_at, due_at, task_url, observed_at
        ) VALUES (
          ${tenantId}::uuid, ${actorOpenId}, ${snapshot.guid}, ${snapshot.title},
          ${snapshot.status}, ${snapshot.completedAt}, ${snapshot.dueAt},
          ${snapshot.url}, ${observedAt}
        )
        ON CONFLICT (tenant_id, actor_open_id, task_guid)
        DO UPDATE SET
          title = EXCLUDED.title,
          status = EXCLUDED.status,
          completed_at = EXCLUDED.completed_at,
          due_at = EXCLUDED.due_at,
          task_url = EXCLUDED.task_url,
          observed_at = EXCLUDED.observed_at
      `;
    }
    return changes;
  }

  async listTaskStatusEvents(
    tenantId: string,
    actorOpenId: string,
    taskGuids: string[],
    since: Date,
    limit: number,
  ): Promise<TaskStatusEventResult> {
    if (taskGuids.length === 0 || limit <= 0) {
      return { items: [] };
    }
    const safeLimit: number = Math.min(Math.max(limit, 1), 1000);
    const rows: TaskStatusEventRow[] = await this.sql<TaskStatusEventRow[]>`
      SELECT
        event_id,
        task_guid,
        event_kind,
        title,
        status,
        completed_at,
        due_at,
        task_url,
        occurred_at,
        previous_title,
        previous_status,
        previous_completed_at,
        previous_due_at,
        related_task_guid,
        relation
      FROM task_status_events
      WHERE tenant_id = ${tenantId}::uuid
        AND actor_open_id = ${actorOpenId}
        AND task_guid = ANY(${this.sql.array(taskGuids)})
        AND occurred_at >= ${since}
      ORDER BY occurred_at DESC
      LIMIT ${safeLimit}
    `;
    return {
      items: rows.map(
        (row: TaskStatusEventRow): TaskStatusEvent =>
          this.mapTaskStatusEvent(row),
      ),
    };
  }

  async recoverStaleExecutingActions(
    now: Date,
    timeoutMs: number,
  ): Promise<PendingAction[]> {
    const cutoff: Date = new Date(now.getTime() - timeoutMs);
    const staleRows: PendingActionRow[] = await this.sql<PendingActionRow[]>`
      SELECT *
      FROM pending_actions
      WHERE status = 'executing'
        AND updated_at <= ${cutoff}
      ORDER BY updated_at ASC
      FOR UPDATE SKIP LOCKED
    `;
    const recovered: PendingAction[] = [];
    for (const row of staleRows) {
      const current: PendingAction = this.mapPendingAction(row);
      const partial: boolean = Boolean(
        current.result.customerRecordId ||
        current.result.opportunityRecordId ||
        current.result.followupRecordId ||
        current.result.taskGuid,
      );
      const status: PendingActionStatus = partial
        ? 'partialFailure'
        : 'failed';
      const result: AgentExecutionResult = {
        ...current.result,
        status,
        errorCode: 'EXECUTION_TIMEOUT',
        errorMessage: '执行超过时间上限，已停止并可安全重试。',
      };
      const resultJson: string = JSON.stringify(result);
      const updated: PendingActionRow[] = await this.sql<PendingActionRow[]>`
        UPDATE pending_actions
        SET status = ${status},
            result = ${resultJson}::text::jsonb,
            updated_at = ${now}
        WHERE tenant_id = ${current.tenantId}
          AND id = ${current.id}
          AND status = 'executing'
        RETURNING *
      `;
      if (updated[0]) recovered.push(this.mapPendingAction(updated[0]));
    }
    return recovered;
  }

  async appendAudit(event: AuditEventInput): Promise<void> {
    const detailsJson: string = JSON.stringify(event.details);
    await this.sql`
      INSERT INTO audit_events (
        tenant_id,
        trace_id,
        event_type,
        actor_open_id,
        entity_id,
        outcome,
        details
      )
      VALUES (
        ${event.tenantId},
        ${event.traceId},
        ${event.eventType},
        ${event.actorOpenId ?? null},
        ${event.entityId ?? null},
        ${event.outcome},
        ${detailsJson}::text::jsonb
      )
    `;
  }

  private async expireAction(
    tenantId: string,
    actionId: string,
    actorOpenId: string,
    now: Date,
  ): Promise<void> {
    await this.sql`
      UPDATE pending_actions
      SET
        status = 'expired',
        result = jsonb_set(
          CASE
            WHEN jsonb_typeof(result) = 'string'
              THEN (result #>> '{}')::jsonb
            ELSE result
          END,
          '{status}',
          '"expired"'::jsonb,
          true
        ),
        updated_at = ${now}
      WHERE tenant_id = ${tenantId}
        AND id = ${actionId}
        AND actor_open_id = ${actorOpenId}
        AND expires_at <= ${now}
        AND status IN ('pendingConfirmation', 'failed', 'partialFailure')
    `;
  }

  private mapSession(row: SessionRow): AgentSession {
    const draftValue: unknown = this.parseJsonColumn(row.draft);
    return {
      ...(row.revision === undefined ? {} : { revision: row.revision }),
      ...(row.state === 'preparation_clarifying'
        ? { preparationContext: parsePreparationContext(this.parseJsonColumn(row.preparation_context ?? null), row.raw_text) }
        : {}),
      id: row.id,
      tenantId: row.tenant_id,
      actorOpenId: row.actor_open_id,
      chatId: row.chat_id,
      state: row.state,
      sourceMessageId: row.source_message_id,
      rawText: row.raw_text,
      draft: draftValue === null ? null : parseFollowupDraft(draftValue),
      expiresAt: this.toDate(row.expires_at),
      createdAt: this.toDate(row.created_at),
      updatedAt: this.toDate(row.updated_at),
    };
  }

  private mapIntegration(
    row: IntegrationRow | undefined,
  ): TenantIntegration | null {
    if (row === undefined) {
      return null;
    }
    return {
      tenantId: row.tenant_id,
      feishuTenantKey: row.feishu_tenant_key,
      name: row.name,
      status: row.status,
      appId: row.app_id,
      appSecretEnv: row.app_secret_env,
      appType: row.app_type,
      base: parseTenantBaseMapping(row.base_mapping),
    };
  }

  private mapPendingAction(row: PendingActionRow): PendingAction {
    const payloadValue: unknown = this.parseJsonColumn(row.payload);
    const resultValue: unknown = this.parseJsonColumn(row.result);
    return {
      id: row.id,
      tenantId: row.tenant_id,
      actorOpenId: row.actor_open_id,
      chatId: row.chat_id,
      cardMessageId: row.card_message_id,
      status: row.status,
      payload: parsePendingActionPayload(payloadValue),
      result: parseAgentExecutionResult(resultValue),
      expiresAt: this.toDate(row.expires_at),
      createdAt: this.toDate(row.created_at),
      updatedAt: this.toDate(row.updated_at),
    };
  }

  private requireSessionRow(rows: SessionRow[]): AgentSession {
    const row: SessionRow | undefined = rows[0];
    if (!row) {
      this.logger.error('Session upsert returned no row');
      throw new Error('Session could not be saved');
    }
    return this.mapSession(row);
  }

  private toDate(value: Date | string): Date {
    return value instanceof Date ? value : new Date(value);
  }

  private mapTaskSnapshot(row: TaskSnapshotRow): TaskStatusSnapshot {
    return {
      guid: row.task_guid,
      title: row.title,
      status: row.status,
      completedAt: row.completed_at === null
        ? null
        : this.toDate(row.completed_at).toISOString(),
      dueAt: row.due_at === null ? null : this.toDate(row.due_at).toISOString(),
      url: row.task_url,
    };
  }

  private toTaskStatusEvent(
    snapshot: TaskStatusSnapshot,
    occurredAt: Date,
    kind: TaskStatusEvent['kind'],
    previous: TaskStatusSnapshot | null,
  ): TaskStatusEvent {
    return {
      eventId: createHash('sha256')
        .update([
          snapshot.guid,
          occurredAt.toISOString(),
          kind,
          snapshot.title,
          snapshot.status,
          snapshot.completedAt ?? '',
          snapshot.dueAt ?? '',
          previous?.title ?? '',
          previous?.status ?? '',
          previous?.completedAt ?? '',
          previous?.dueAt ?? '',
        ].join('\u0000'))
        .digest('hex'),
      guid: snapshot.guid,
      kind,
      title: snapshot.title,
      status: snapshot.status,
      completedAt: snapshot.completedAt,
      dueAt: snapshot.dueAt,
      url: snapshot.url,
      occurredAt: occurredAt.toISOString(),
      previousTitle: previous?.title ?? null,
      previousStatus: previous?.status ?? null,
      previousCompletedAt: previous?.completedAt ?? null,
      previousDueAt: previous?.dueAt ?? null,
      relatedTaskGuid: null,
      relation: null,
    };
  }

  private async insertTaskStatusEvent(
    tenantId: string,
    actorOpenId: string,
    event: TaskStatusEvent,
  ): Promise<void> {
    await this.sql`
      INSERT INTO task_status_events (
        tenant_id,
        actor_open_id,
        event_id,
        task_guid,
        event_kind,
        title,
        status,
        completed_at,
        due_at,
        task_url,
        occurred_at,
        previous_title,
        previous_status,
        previous_completed_at,
        previous_due_at,
        related_task_guid,
        relation
      ) VALUES (
        ${tenantId}::uuid,
        ${actorOpenId},
        ${event.eventId},
        ${event.guid},
        ${event.kind},
        ${event.title},
        ${event.status},
        ${event.completedAt},
        ${event.dueAt},
        ${event.url},
        ${event.occurredAt},
        ${event.previousTitle},
        ${event.previousStatus},
        ${event.previousCompletedAt},
        ${event.previousDueAt},
        ${event.relatedTaskGuid},
        ${event.relation}
      )
      ON CONFLICT (tenant_id, actor_open_id, event_id) DO NOTHING
    `;
  }

  private mapTaskStatusEvent(row: TaskStatusEventRow): TaskStatusEvent {
    return {
      eventId: row.event_id,
      guid: row.task_guid,
      kind: row.event_kind,
      title: row.title,
      status: row.status,
      completedAt: row.completed_at === null
        ? null
        : this.toDate(row.completed_at).toISOString(),
      dueAt: row.due_at === null ? null : this.toDate(row.due_at).toISOString(),
      url: row.task_url,
      occurredAt: this.toDate(row.occurred_at).toISOString(),
      previousTitle: row.previous_title,
      previousStatus: row.previous_status,
      previousCompletedAt: row.previous_completed_at === null
        ? null
        : this.toDate(row.previous_completed_at).toISOString(),
      previousDueAt: row.previous_due_at === null
        ? null
        : this.toDate(row.previous_due_at).toISOString(),
      relatedTaskGuid: row.related_task_guid,
      relation: row.relation,
    };
  }

  private taskSnapshotChanged(
    previous: TaskStatusSnapshot,
    current: TaskStatusSnapshot,
  ): boolean {
    return previous.title !== current.title ||
      previous.status !== current.status ||
      previous.completedAt !== current.completedAt ||
      previous.dueAt !== current.dueAt ||
      previous.url !== current.url;
  }

  private parseJsonColumn(value: unknown): unknown {
    if (typeof value !== 'string') {
      return value;
    }
    return JSON.parse(value) as unknown;
  }
}
