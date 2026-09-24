import {
  Inject,
  Injectable,
  Logger,
} from '@nestjs/common';

import type { Sql } from 'postgres';
import type {
  AgentExecutionResult,
  AgentSessionState,
  PendingActionStatus,
} from '@shared/api.interface';
import type { ControlStore } from '@server/modules/agent-core/agent.ports';
import type {
  AgentSession,
  AuditEventInput,
  CreatePendingActionInput,
  PendingAction,
  SaveCollectingSessionInput,
  SaveIntentClarificationSessionInput,
  TenantIntegration,
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
        AND status IN ('pendingConfirmation', 'failed', 'partialFailure', 'executing')
    `;
  }

  private mapSession(row: SessionRow): AgentSession {
    const draftValue: unknown = this.parseJsonColumn(row.draft);
    return {
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

  private parseJsonColumn(value: unknown): unknown {
    if (typeof value !== 'string') {
      return value;
    }
    return JSON.parse(value) as unknown;
  }
}
