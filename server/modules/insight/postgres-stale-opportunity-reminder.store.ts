import { randomUUID } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';
import type { Sql } from 'postgres';

import { AGENT_DATABASE } from '@server/modules/control-store/postgres-control.store';

import type {
  StaleOpportunityReminderClaimInput,
  StaleOpportunityReminderClaimResult,
  StaleOpportunityReminderDispatchInput,
  StaleOpportunityReminderMarkFailedInput,
  StaleOpportunityReminderMarkSentInput,
  StaleOpportunityReminderMarkUnknownInput,
  StaleOpportunityReminderReconcileInput,
  StaleOpportunityReminderReconcileResult,
  StaleOpportunityReminderReconciler,
  StaleOpportunityReminderStore,
  StaleOpportunityReminderUncertainRecord,
} from './stale-opportunity-reminder.service';

interface ReminderRow {
  status: 'claimed' | 'dispatching' | 'sent' | 'failed' | 'uncertain';
  claim_token: string;
  claim_expires_at: Date | string;
  attempt_count: number;
  sent_at: Date | string | null;
  retry_after: Date | string | null;
}

interface UpdatedRow {
  claim_token: string;
}

interface UncertainReminderRow {
  tenant_id: string;
  opportunity_record_id: string;
  followup_version: string;
  reminder_kind: 'stale_followup';
  opportunity_name: string;
  owner_open_id: string;
  attempt_count: number;
  dispatch_started_at: Date | string | null;
  failure_code: string | null;
  failure_message: string | null;
  updated_at: Date | string;
}

interface ReconciledReminderRow {
  reconciliation_id: string;
  previous_status: 'uncertain';
  resulting_status: 'sent' | 'failed' | 'uncertain';
  reconciled_at: Date | string;
}

interface ReminderStateRow {
  status: 'claimed' | 'dispatching' | 'sent' | 'failed' | 'uncertain';
  updated_at: Date | string;
}

const toDate = (value: Date | string): Date =>
  value instanceof Date ? value : new Date(value);

@Injectable()
class PostgresStaleOpportunityReminderStore
implements StaleOpportunityReminderStore,
StaleOpportunityReminderReconciler {
  constructor(
    @Inject(AGENT_DATABASE)
    private readonly sql: Sql,
  ) {}

  async claim(
    input: StaleOpportunityReminderClaimInput,
  ): Promise<StaleOpportunityReminderClaimResult> {
    if (input.claimDurationMs <= 0 || input.cooldownMs <= 0) {
      throw new Error('Reminder claim and cooldown durations must be positive');
    }
    const claimToken: string = randomUUID();
    const claimExpiresAt: Date = new Date(
      input.now.getTime() + input.claimDurationMs,
    );
    const cooldownCutoff: Date = new Date(
      input.now.getTime() - input.cooldownMs,
    );
    const rows: ReminderRow[] = await this.sql<ReminderRow[]>`
      INSERT INTO stale_opportunity_reminders (
        tenant_id,
        opportunity_record_id,
        followup_version,
        reminder_kind,
        opportunity_name,
        owner_open_id,
        status,
        claim_token,
        claim_expires_at,
        attempt_count,
        last_attempt_at
      ) VALUES (
        ${input.tenantId}::uuid,
        ${input.opportunityRecordId},
        ${input.followupVersion},
        ${input.reminderKind},
        ${input.opportunityName},
        ${input.ownerOpenId},
        'claimed',
        ${claimToken}::uuid,
        ${claimExpiresAt},
        1,
        ${input.now}
      )
      ON CONFLICT (
        tenant_id,
        opportunity_record_id,
        followup_version,
        reminder_kind
      ) DO UPDATE SET
        opportunity_name = EXCLUDED.opportunity_name,
        owner_open_id = EXCLUDED.owner_open_id,
        status = 'claimed',
        claim_token = EXCLUDED.claim_token,
        claim_expires_at = EXCLUDED.claim_expires_at,
        attempt_count = stale_opportunity_reminders.attempt_count + 1,
        last_attempt_at = EXCLUDED.last_attempt_at,
        retry_after = NULL,
        failure_code = NULL,
        failure_message = NULL,
        updated_at = EXCLUDED.last_attempt_at
      WHERE (
        stale_opportunity_reminders.status = 'claimed'
        AND stale_opportunity_reminders.claim_expires_at <= ${input.now}
      ) OR (
        stale_opportunity_reminders.status = 'failed'
        AND COALESCE(
          stale_opportunity_reminders.retry_after,
          '-infinity'::timestamptz
        ) <= ${input.now}
      ) OR (
        stale_opportunity_reminders.status = 'sent'
        AND stale_opportunity_reminders.sent_at <= ${cooldownCutoff}
      )
      RETURNING
        status,
        claim_token,
        claim_expires_at,
        attempt_count,
        sent_at,
        retry_after
    `;
    const claimed: ReminderRow | undefined = rows[0];
    if (claimed) {
      return {
        status: 'claimed',
        claimToken: claimed.claim_token,
        attemptCount: claimed.attempt_count,
      };
    }

    const existing: ReminderRow | undefined = (await this.sql<ReminderRow[]>`
      SELECT
        status,
        claim_token,
        claim_expires_at,
        attempt_count,
        sent_at,
        retry_after
      FROM stale_opportunity_reminders
      WHERE tenant_id = ${input.tenantId}::uuid
        AND opportunity_record_id = ${input.opportunityRecordId}
        AND followup_version = ${input.followupVersion}
        AND reminder_kind = ${input.reminderKind}
      LIMIT 1
    `)[0];
    if (!existing) {
      throw new Error('Reminder claim state disappeared during acquisition');
    }
    if (existing.status === 'claimed') {
      return {
        status: 'in_flight',
        retryAt: toDate(existing.claim_expires_at),
      };
    }
    if (existing.status === 'failed') {
      if (!existing.retry_after) {
        throw new Error('Failed reminder is missing retry_after');
      }
      return {
        status: 'retry_scheduled',
        retryAt: toDate(existing.retry_after),
      };
    }
    if (existing.status === 'dispatching' || existing.status === 'uncertain') {
      return { status: 'delivery_unknown' };
    }
    if (!existing.sent_at) {
      throw new Error('Sent reminder is missing sent_at');
    }
    return {
      status: 'cooling_down',
      retryAt: new Date(toDate(existing.sent_at).getTime() + input.cooldownMs),
    };
  }

  async markDispatchStarted(
    input: StaleOpportunityReminderDispatchInput,
  ): Promise<boolean> {
    const rows: UpdatedRow[] = await this.sql<UpdatedRow[]>`
      UPDATE stale_opportunity_reminders
      SET
        status = 'dispatching',
        dispatch_started_at = ${input.startedAt},
        updated_at = ${input.startedAt}
      WHERE tenant_id = ${input.tenantId}::uuid
        AND opportunity_record_id = ${input.opportunityRecordId}
        AND followup_version = ${input.followupVersion}
        AND reminder_kind = ${input.reminderKind}
        AND status = 'claimed'
        AND claim_token = ${input.claimToken}::uuid
      RETURNING claim_token
    `;
    return rows.length === 1;
  }

  async markSent(
    input: StaleOpportunityReminderMarkSentInput,
  ): Promise<boolean> {
    const rows: UpdatedRow[] = await this.sql<UpdatedRow[]>`
      UPDATE stale_opportunity_reminders
      SET
        status = 'sent',
        message_id = ${input.messageId},
        sent_at = ${input.sentAt},
        retry_after = NULL,
        failure_code = NULL,
        failure_message = NULL,
        updated_at = ${input.sentAt}
      WHERE tenant_id = ${input.tenantId}::uuid
        AND opportunity_record_id = ${input.opportunityRecordId}
        AND followup_version = ${input.followupVersion}
        AND reminder_kind = ${input.reminderKind}
        AND status = 'dispatching'
        AND claim_token = ${input.claimToken}::uuid
      RETURNING claim_token
    `;
    return rows.length === 1;
  }

  async markFailed(
    input: StaleOpportunityReminderMarkFailedInput,
  ): Promise<boolean> {
    const rows: UpdatedRow[] = await this.sql<UpdatedRow[]>`
      UPDATE stale_opportunity_reminders
      SET
        status = 'failed',
        retry_after = ${input.retryAt},
        failure_code = ${input.failureCode},
        failure_message = ${input.failureMessage},
        updated_at = ${input.failedAt}
      WHERE tenant_id = ${input.tenantId}::uuid
        AND opportunity_record_id = ${input.opportunityRecordId}
        AND followup_version = ${input.followupVersion}
        AND reminder_kind = ${input.reminderKind}
        AND status = 'dispatching'
        AND claim_token = ${input.claimToken}::uuid
      RETURNING claim_token
    `;
    return rows.length === 1;
  }

  async markDeliveryUnknown(
    input: StaleOpportunityReminderMarkUnknownInput,
  ): Promise<boolean> {
    const rows: UpdatedRow[] = await this.sql<UpdatedRow[]>`
      UPDATE stale_opportunity_reminders
      SET
        status = 'uncertain',
        retry_after = NULL,
        failure_code = ${input.failureCode},
        failure_message = ${input.failureMessage},
        updated_at = ${input.failedAt}
      WHERE tenant_id = ${input.tenantId}::uuid
        AND opportunity_record_id = ${input.opportunityRecordId}
        AND followup_version = ${input.followupVersion}
        AND reminder_kind = ${input.reminderKind}
        AND status = 'dispatching'
        AND claim_token = ${input.claimToken}::uuid
      RETURNING claim_token
    `;
    return rows.length === 1;
  }

  async listUncertain(input: {
    tenantId?: string;
    limit?: number;
  }): Promise<StaleOpportunityReminderUncertainRecord[]> {
    const limit: number = input.limit ?? 50;
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
      throw new Error('Uncertain reminder limit must be between 1 and 100');
    }
    const rows: UncertainReminderRow[] = input.tenantId
      ? await this.sql`
          SELECT
            tenant_id,
            opportunity_record_id,
            followup_version,
            reminder_kind,
            opportunity_name,
            owner_open_id,
            attempt_count,
            dispatch_started_at,
            failure_code,
            failure_message,
            updated_at
          FROM stale_opportunity_reminders
          WHERE status = 'uncertain'
            AND tenant_id = ${input.tenantId}::uuid
          ORDER BY updated_at ASC
          LIMIT ${limit}
        `
      : await this.sql`
          SELECT
            tenant_id,
            opportunity_record_id,
            followup_version,
            reminder_kind,
            opportunity_name,
            owner_open_id,
            attempt_count,
            dispatch_started_at,
            failure_code,
            failure_message,
            updated_at
          FROM stale_opportunity_reminders
          WHERE status = 'uncertain'
          ORDER BY updated_at ASC
          LIMIT ${limit}
        `;
    return rows.map(
      (row: UncertainReminderRow): StaleOpportunityReminderUncertainRecord => ({
        tenantId: row.tenant_id,
        opportunityRecordId: row.opportunity_record_id,
        followupVersion: row.followup_version,
        reminderKind: row.reminder_kind,
        opportunityName: row.opportunity_name,
        ownerOpenId: row.owner_open_id,
        attemptCount: row.attempt_count,
        dispatchStartedAt: row.dispatch_started_at === null
          ? null
          : toDate(row.dispatch_started_at).toISOString(),
        failureCode: row.failure_code,
        failureMessage: row.failure_message,
        updatedAt: toDate(row.updated_at).toISOString(),
      }),
    );
  }

  async reconcile(
    input: StaleOpportunityReminderReconcileInput,
  ): Promise<StaleOpportunityReminderReconcileResult> {
    const resultingStatus: 'sent' | 'failed' | 'uncertain' =
      input.decision === 'confirm_sent'
        ? 'sent'
        : input.decision === 'authorize_retry'
          ? 'failed'
          : 'uncertain';
    const rows: ReconciledReminderRow[] =
      await this.sql<ReconciledReminderRow[]>`
        WITH candidate AS (
          SELECT
            tenant_id,
            opportunity_record_id,
            followup_version,
            reminder_kind,
            status AS previous_status,
            dispatch_started_at,
            failure_code,
            failure_message
          FROM stale_opportunity_reminders
          WHERE tenant_id = ${input.tenantId}::uuid
            AND opportunity_record_id = ${input.opportunityRecordId}
            AND followup_version = ${input.followupVersion}
            AND reminder_kind = ${input.reminderKind}
            AND status = 'uncertain'
            AND updated_at = ${input.expectedUpdatedAt}
          FOR UPDATE
        ), updated AS (
          UPDATE stale_opportunity_reminders AS reminder
          SET
            status = ${resultingStatus},
            message_id = CASE
              WHEN ${input.decision} = 'confirm_sent'
                THEN ${input.messageId ?? null}
              ELSE reminder.message_id
            END,
            sent_at = CASE
              WHEN ${input.decision} = 'confirm_sent'
                THEN ${input.sentAt ?? null}
              ELSE reminder.sent_at
            END,
            retry_after = CASE
              WHEN ${input.decision} = 'authorize_retry'
                THEN ${input.reconciledAt}
              WHEN ${input.decision} = 'confirm_sent'
                THEN NULL
              ELSE reminder.retry_after
            END,
            updated_at = ${input.reconciledAt}
          FROM candidate
          WHERE reminder.tenant_id = candidate.tenant_id
            AND reminder.opportunity_record_id =
              candidate.opportunity_record_id
            AND reminder.followup_version = candidate.followup_version
            AND reminder.reminder_kind = candidate.reminder_kind
          RETURNING
            reminder.tenant_id,
            reminder.opportunity_record_id,
            reminder.followup_version,
            reminder.reminder_kind,
            candidate.previous_status,
            reminder.status AS resulting_status,
            candidate.dispatch_started_at,
            candidate.failure_code,
            candidate.failure_message
        )
        INSERT INTO stale_opportunity_reminder_reconciliations (
          tenant_id,
          opportunity_record_id,
          followup_version,
          reminder_kind,
          expected_updated_at,
          previous_status,
          decision,
          resulting_status,
          operator_member_id,
          note,
          evidence_message_id,
          evidence_sent_at,
          original_dispatch_started_at,
          original_failure_code,
          original_failure_message,
          reconciled_at
        )
        SELECT
          updated.tenant_id,
          updated.opportunity_record_id,
          updated.followup_version,
          updated.reminder_kind,
          ${input.expectedUpdatedAt},
          updated.previous_status,
          ${input.decision},
          updated.resulting_status,
          ${input.operatorMemberId}::uuid,
          ${input.note},
          ${input.messageId ?? null},
          ${input.sentAt ?? null},
          updated.dispatch_started_at,
          updated.failure_code,
          updated.failure_message,
          ${input.reconciledAt}
        FROM updated
        RETURNING
          id AS reconciliation_id,
          previous_status,
          resulting_status,
          reconciled_at
      `;
    const reconciled: ReconciledReminderRow | undefined = rows[0];
    if (reconciled) {
      return {
        status: 'reconciled',
        reconciliationId: reconciled.reconciliation_id,
        previousStatus: reconciled.previous_status,
        currentStatus: reconciled.resulting_status,
        updatedAt: toDate(reconciled.reconciled_at),
      };
    }

    const existing: ReminderStateRow | undefined =
      (await this.sql<ReminderStateRow[]>`
        SELECT status, updated_at
        FROM stale_opportunity_reminders
        WHERE tenant_id = ${input.tenantId}::uuid
          AND opportunity_record_id = ${input.opportunityRecordId}
          AND followup_version = ${input.followupVersion}
          AND reminder_kind = ${input.reminderKind}
        LIMIT 1
      `)[0];
    if (!existing) {
      return { status: 'not_found' };
    }
    return {
      status: 'conflict',
      currentStatus: existing.status,
      currentUpdatedAt: toDate(existing.updated_at),
    };
  }
}

export { PostgresStaleOpportunityReminderStore };
