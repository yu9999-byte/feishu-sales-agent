import { randomUUID } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';
import type { Sql } from 'postgres';

import { AGENT_DATABASE } from '@server/modules/control-store/postgres-control.store';
import type {
  ProactiveNotificationClaimInput,
  ProactiveNotificationClaimResult,
  ProactiveNotificationStateInput,
  ProactiveNotificationStore,
} from './proactive-notification-delivery.service';

interface NotificationRow {
  status: 'claimed' | 'dispatching' | 'sent' | 'failed' | 'uncertain';
  claim_token: string;
  claim_expires_at: Date | string;
  attempt_count: number;
  retry_after: Date | string | null;
}

interface UpdatedRow {
  claim_token: string;
}

interface ProactiveRiskState {
  tenantId: string;
  recipientMemberId: string;
  opportunityRecordId: string;
  severityRank: number;
  payloadFingerprint: string;
  observedAt: Date;
}

interface RiskStateRow {
  tenant_id: string;
  recipient_member_id: string;
  opportunity_record_id: string;
  severity_rank: number;
  payload_fingerprint: string;
  observed_at: Date | string;
}

interface ProactiveRiskStateStore {
  getRiskState(input: {
    tenantId: string;
    recipientMemberId: string;
    opportunityRecordId: string;
  }): Promise<ProactiveRiskState | null>;
  saveRiskState(input: ProactiveRiskState): Promise<void>;
}

const toDate = (value: Date | string): Date =>
  value instanceof Date ? value : new Date(value);

@Injectable()
class PostgresProactiveNotificationStore
implements ProactiveNotificationStore, ProactiveRiskStateStore {
  constructor(
    @Inject(AGENT_DATABASE)
    private readonly sql: Sql,
  ) {}

  async claim(
    input: ProactiveNotificationClaimInput,
  ): Promise<ProactiveNotificationClaimResult> {
    const claimToken: string = randomUUID();
    const claimExpiresAt: Date = new Date(
      input.now.getTime() + input.claimDurationMs,
    );
    const rows: NotificationRow[] = await this.sql<NotificationRow[]>`
      INSERT INTO proactive_sales_notifications (
        tenant_id,
        recipient_member_id,
        recipient_open_id,
        kind,
        notification_key,
        subject_key,
        payload_fingerprint,
        status,
        claim_token,
        claim_expires_at,
        attempt_count,
        last_attempt_at
      ) VALUES (
        ${input.tenantId}::uuid,
        ${input.recipientMemberId}::uuid,
        ${input.recipientOpenId},
        ${input.kind},
        ${input.notificationKey},
        ${input.subjectKey},
        ${input.payloadFingerprint},
        'claimed',
        ${claimToken}::uuid,
        ${claimExpiresAt},
        1,
        ${input.now}
      )
      ON CONFLICT (
        tenant_id,
        recipient_member_id,
        kind,
        notification_key
      ) DO UPDATE SET
        recipient_open_id = EXCLUDED.recipient_open_id,
        subject_key = EXCLUDED.subject_key,
        payload_fingerprint = EXCLUDED.payload_fingerprint,
        status = 'claimed',
        claim_token = EXCLUDED.claim_token,
        claim_expires_at = EXCLUDED.claim_expires_at,
        attempt_count = proactive_sales_notifications.attempt_count + 1,
        last_attempt_at = EXCLUDED.last_attempt_at,
        retry_after = NULL,
        failure_code = NULL,
        failure_message = NULL,
        updated_at = EXCLUDED.last_attempt_at
      WHERE (
        proactive_sales_notifications.status = 'claimed'
        AND proactive_sales_notifications.claim_expires_at <= ${input.now}
      ) OR (
        proactive_sales_notifications.status = 'failed'
        AND proactive_sales_notifications.attempt_count < ${input.maxAttempts}
        AND proactive_sales_notifications.retry_after <= ${input.now}
      )
      RETURNING
        status,
        claim_token,
        claim_expires_at,
        attempt_count,
        retry_after
    `;
    const claimed: NotificationRow | undefined = rows[0];
    if (claimed) {
      return {
        status: 'claimed',
        claimToken: claimed.claim_token,
        attemptCount: claimed.attempt_count,
      };
    }
    const existing: NotificationRow | undefined =
      (await this.sql<NotificationRow[]>`
        SELECT
          status,
          claim_token,
          claim_expires_at,
          attempt_count,
          retry_after
        FROM proactive_sales_notifications
        WHERE tenant_id = ${input.tenantId}::uuid
          AND recipient_member_id = ${input.recipientMemberId}::uuid
          AND kind = ${input.kind}
          AND notification_key = ${input.notificationKey}
        LIMIT 1
      `)[0];
    if (!existing) {
      throw new Error('Proactive notification claim disappeared');
    }
    if (existing.status === 'claimed') return { status: 'in_flight' };
    if (existing.status === 'dispatching' || existing.status === 'uncertain') {
      return { status: 'delivery_unknown' };
    }
    if (existing.status === 'sent') return { status: 'already_sent' };
    if (existing.attempt_count >= input.maxAttempts) {
      return {
        status: 'attempts_exhausted',
        ...(existing.retry_after
          ? { retryAt: toDate(existing.retry_after) }
          : {}),
      };
    }
    return {
      status: 'retry_scheduled',
      ...(existing.retry_after
        ? { retryAt: toDate(existing.retry_after) }
        : {}),
    };
  }

  async markDispatchStarted(
    input: ProactiveNotificationStateInput & { startedAt: Date },
  ): Promise<boolean> {
    return this.updateState(input, 'dispatching', input.startedAt);
  }

  async markSent(
    input: ProactiveNotificationStateInput & {
      messageId: string;
      sentAt: Date;
    },
  ): Promise<boolean> {
    const rows: UpdatedRow[] = await this.sql<UpdatedRow[]>`
      UPDATE proactive_sales_notifications
      SET
        status = 'sent',
        message_id = ${input.messageId},
        sent_at = ${input.sentAt},
        retry_after = NULL,
        failure_code = NULL,
        failure_message = NULL,
        updated_at = ${input.sentAt}
      WHERE tenant_id = ${input.tenantId}::uuid
        AND recipient_member_id = ${input.recipientMemberId}::uuid
        AND kind = ${input.kind}
        AND notification_key = ${input.notificationKey}
        AND claim_token = ${input.claimToken}::uuid
        AND status = 'dispatching'
      RETURNING claim_token
    `;
    return rows.length === 1;
  }

  async markFailed(
    input: ProactiveNotificationStateInput & {
      failedAt: Date;
      retryAt: Date;
      failureCode: string;
      failureMessage: string;
    },
  ): Promise<boolean> {
    const rows: UpdatedRow[] = await this.sql<UpdatedRow[]>`
      UPDATE proactive_sales_notifications
      SET
        status = 'failed',
        retry_after = ${input.retryAt},
        failure_code = ${input.failureCode},
        failure_message = ${input.failureMessage},
        updated_at = ${input.failedAt}
      WHERE tenant_id = ${input.tenantId}::uuid
        AND recipient_member_id = ${input.recipientMemberId}::uuid
        AND kind = ${input.kind}
        AND notification_key = ${input.notificationKey}
        AND claim_token = ${input.claimToken}::uuid
        AND status = 'dispatching'
      RETURNING claim_token
    `;
    return rows.length === 1;
  }

  async markDeliveryUnknown(
    input: ProactiveNotificationStateInput & {
      failedAt: Date;
      failureCode: string;
      failureMessage: string;
    },
  ): Promise<boolean> {
    const rows: UpdatedRow[] = await this.sql<UpdatedRow[]>`
      UPDATE proactive_sales_notifications
      SET
        status = 'uncertain',
        retry_after = NULL,
        failure_code = ${input.failureCode},
        failure_message = ${input.failureMessage},
        updated_at = ${input.failedAt}
      WHERE tenant_id = ${input.tenantId}::uuid
        AND recipient_member_id = ${input.recipientMemberId}::uuid
        AND kind = ${input.kind}
        AND notification_key = ${input.notificationKey}
        AND claim_token = ${input.claimToken}::uuid
        AND status = 'dispatching'
      RETURNING claim_token
    `;
    return rows.length === 1;
  }

  async getRiskState(input: {
    tenantId: string;
    recipientMemberId: string;
    opportunityRecordId: string;
  }): Promise<ProactiveRiskState | null> {
    const row: RiskStateRow | undefined = (await this.sql<RiskStateRow[]>`
      SELECT
        tenant_id,
        recipient_member_id,
        opportunity_record_id,
        severity_rank,
        payload_fingerprint,
        observed_at
      FROM proactive_sales_risk_states
      WHERE tenant_id = ${input.tenantId}::uuid
        AND recipient_member_id = ${input.recipientMemberId}::uuid
        AND opportunity_record_id = ${input.opportunityRecordId}
      LIMIT 1
    `)[0];
    return row ? {
      tenantId: row.tenant_id,
      recipientMemberId: row.recipient_member_id,
      opportunityRecordId: row.opportunity_record_id,
      severityRank: row.severity_rank,
      payloadFingerprint: row.payload_fingerprint,
      observedAt: toDate(row.observed_at),
    } : null;
  }

  async saveRiskState(input: ProactiveRiskState): Promise<void> {
    await this.sql`
      INSERT INTO proactive_sales_risk_states (
        tenant_id,
        recipient_member_id,
        opportunity_record_id,
        severity_rank,
        payload_fingerprint,
        observed_at
      ) VALUES (
        ${input.tenantId}::uuid,
        ${input.recipientMemberId}::uuid,
        ${input.opportunityRecordId},
        ${input.severityRank},
        ${input.payloadFingerprint},
        ${input.observedAt}
      )
      ON CONFLICT (
        tenant_id,
        recipient_member_id,
        opportunity_record_id
      ) DO UPDATE SET
        severity_rank = EXCLUDED.severity_rank,
        payload_fingerprint = EXCLUDED.payload_fingerprint,
        observed_at = EXCLUDED.observed_at,
        updated_at = EXCLUDED.observed_at
    `;
  }

  private async updateState(
    input: ProactiveNotificationStateInput,
    status: 'dispatching',
    updatedAt: Date,
  ): Promise<boolean> {
    const rows: UpdatedRow[] = await this.sql<UpdatedRow[]>`
      UPDATE proactive_sales_notifications
      SET
        status = ${status},
        dispatch_started_at = ${updatedAt},
        updated_at = ${updatedAt}
      WHERE tenant_id = ${input.tenantId}::uuid
        AND recipient_member_id = ${input.recipientMemberId}::uuid
        AND kind = ${input.kind}
        AND notification_key = ${input.notificationKey}
        AND claim_token = ${input.claimToken}::uuid
        AND status = 'claimed'
      RETURNING claim_token
    `;
    return rows.length === 1;
  }
}

export { PostgresProactiveNotificationStore };
export type { ProactiveRiskState, ProactiveRiskStateStore };
