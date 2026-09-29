import { randomUUID } from 'node:crypto';

import type { Sql } from 'postgres';

import type {
  StaleOpportunityReminderClaimInput,
  StaleOpportunityReminderClaimResult,
  StaleOpportunityReminderDispatchInput,
  StaleOpportunityReminderMarkFailedInput,
  StaleOpportunityReminderMarkSentInput,
  StaleOpportunityReminderMarkUnknownInput,
  StaleOpportunityReminderStore,
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

const toDate = (value: Date | string): Date =>
  value instanceof Date ? value : new Date(value);

class PostgresStaleOpportunityReminderStore
implements StaleOpportunityReminderStore {
  constructor(private readonly sql: Sql) {}

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
}

export { PostgresStaleOpportunityReminderStore };
