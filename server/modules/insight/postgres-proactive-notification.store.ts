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
import type {
  ProactiveNotificationReconcileInput,
  ProactiveNotificationReconcileResult,
  ProactiveNotificationReconciliationStore,
  ProactiveNotificationUncertainRecord,
} from './proactive-notification-reconciliation.service';

interface NotificationRow {
  status: 'claimed' | 'dispatching' | 'sent' | 'failed' | 'uncertain';
  claim_token: string;
  claim_expires_at: Date | string;
  attempt_count: number;
  retry_after: Date | string | null;
  attempt_limit: number | null;
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

interface ProactiveNotificationUncertainRow {
  id: string;
  tenant_id: string;
  recipient_member_id: string;
  recipient_display_name: string;
  kind: ProactiveNotificationUncertainRecord['kind'];
  notification_key: string;
  subject_key: string;
  attempt_count: number;
  dispatch_started_at: Date | string | null;
  failure_code: string | null;
  failure_message: string | null;
  updated_at: Date | string;
}

interface ProactiveNotificationReconciledRow {
  reconciliation_id: string;
  previous_status: 'uncertain';
  resulting_status: 'sent' | 'failed' | 'uncertain';
  reconciled_at: Date | string;
}

interface ProactiveNotificationStateRow {
  status: 'claimed' | 'dispatching' | 'sent' | 'failed' | 'uncertain';
  updated_at: Date | string;
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
implements ProactiveNotificationStore, ProactiveRiskStateStore,
ProactiveNotificationReconciliationStore {
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
        AND proactive_sales_notifications.attempt_count < COALESCE(
          proactive_sales_notifications.attempt_limit,
          ${input.maxAttempts}
        )
        AND proactive_sales_notifications.retry_after <= ${input.now}
      )
      RETURNING
        status,
        claim_token,
        claim_expires_at,
        attempt_count,
        retry_after,
        attempt_limit
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
          retry_after,
          attempt_limit
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
    const attemptLimit: number = existing.attempt_limit ?? input.maxAttempts;
    if (existing.attempt_count >= attemptLimit) {
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

  async listUncertain(input: {
    tenantId: string;
    limit: number;
  }): Promise<ProactiveNotificationUncertainRecord[]> {
    const rows: ProactiveNotificationUncertainRow[] =
      await this.sql<ProactiveNotificationUncertainRow[]>`
        SELECT
          notification.id,
          notification.tenant_id,
          notification.recipient_member_id,
          member.display_name AS recipient_display_name,
          notification.kind,
          notification.notification_key,
          notification.subject_key,
          notification.attempt_count,
          notification.dispatch_started_at,
          notification.failure_code,
          notification.failure_message,
          notification.updated_at
        FROM proactive_sales_notifications AS notification
        INNER JOIN tenant_members AS member
          ON member.tenant_id = notification.tenant_id
          AND member.id = notification.recipient_member_id
        WHERE notification.tenant_id = ${input.tenantId}::uuid
          AND notification.status = 'uncertain'
        ORDER BY notification.updated_at DESC, notification.id ASC
        LIMIT ${input.limit}
      `;
    return rows.map(
      (row: ProactiveNotificationUncertainRow):
      ProactiveNotificationUncertainRecord => ({
        notificationId: row.id,
        tenantId: row.tenant_id,
        recipientMemberId: row.recipient_member_id,
        recipientDisplayName: row.recipient_display_name,
        kind: row.kind,
        notificationKey: row.notification_key,
        subjectKey: row.subject_key,
        attemptCount: row.attempt_count,
        dispatchStartedAt: row.dispatch_started_at === null
          ? null
          : toDate(row.dispatch_started_at).toISOString(),
        failureCode: row.failure_code,
        failureMessage: row.failure_message?.slice(0, 500) ?? null,
        updatedAt: toDate(row.updated_at).toISOString(),
      }),
    );
  }

  async reconcile(
    input: ProactiveNotificationReconcileInput,
  ): Promise<ProactiveNotificationReconcileResult> {
    const resultingStatus: 'sent' | 'failed' | 'uncertain' =
      input.decision === 'confirm_sent'
        ? 'sent'
        : input.decision === 'authorize_retry'
          ? 'failed'
          : 'uncertain';
    const rows: ProactiveNotificationReconciledRow[] =
      await this.sql<ProactiveNotificationReconciledRow[]>`
        WITH current_notification AS (
          SELECT
            tenant_id,
            id,
            status,
            attempt_count,
            dispatch_started_at,
            failure_code,
            failure_message
          FROM proactive_sales_notifications
          WHERE tenant_id = ${input.tenantId}::uuid
            AND id = ${input.notificationId}::uuid
            AND status = 'uncertain'
            AND updated_at = ${input.expectedUpdatedAt}
          FOR UPDATE
        ), updated_notification AS (
          UPDATE proactive_sales_notifications AS notification
          SET
            status = ${resultingStatus},
            message_id = CASE
              WHEN ${input.decision} = 'confirm_sent'
                THEN ${input.messageId ?? null}
              ELSE notification.message_id
            END,
            sent_at = CASE
              WHEN ${input.decision} = 'confirm_sent'
                THEN ${input.sentAt ?? null}
              ELSE notification.sent_at
            END,
            retry_after = CASE
              WHEN ${input.decision} = 'authorize_retry'
                THEN ${input.reconciledAt}
              WHEN ${input.decision} = 'confirm_sent'
                THEN NULL
              ELSE notification.retry_after
            END,
            failure_code = CASE
              WHEN ${input.decision} = 'authorize_retry'
                THEN 'MANUAL_RETRY_AUTHORIZED'
              WHEN ${input.decision} = 'confirm_sent'
                THEN NULL
              ELSE notification.failure_code
            END,
            failure_message = CASE
              WHEN ${input.decision} = 'authorize_retry'
                THEN 'Administrator confirmed not delivered; one retry released'
              WHEN ${input.decision} = 'confirm_sent'
                THEN NULL
              ELSE notification.failure_message
            END,
            attempt_limit = CASE
              WHEN ${input.decision} = 'authorize_retry'
                THEN current_notification.attempt_count + 1
              ELSE notification.attempt_limit
            END,
            updated_at = ${input.reconciledAt}
          FROM current_notification
          WHERE notification.tenant_id = current_notification.tenant_id
            AND notification.id = current_notification.id
          RETURNING
            notification.tenant_id,
            notification.id,
            notification.status,
            notification.updated_at
        ), reconciliation AS (
          INSERT INTO proactive_sales_notification_reconciliations (
            tenant_id,
            notification_id,
            expected_updated_at,
            previous_status,
            decision,
            resulting_status,
            operator_member_id,
            note,
            evidence_message_id,
            evidence_sent_at,
            original_attempt_count,
            original_dispatch_started_at,
            original_failure_code,
            original_failure_message,
            reconciled_at
          )
          SELECT
            current_notification.tenant_id,
            current_notification.id,
            ${input.expectedUpdatedAt},
            'uncertain',
            ${input.decision},
            updated_notification.status,
            ${input.operatorMemberId}::uuid,
            ${input.note},
            ${input.messageId ?? null},
            ${input.sentAt ?? null},
            current_notification.attempt_count,
            current_notification.dispatch_started_at,
            current_notification.failure_code,
            current_notification.failure_message,
            ${input.reconciledAt}
          FROM current_notification
          INNER JOIN updated_notification
            ON updated_notification.tenant_id = current_notification.tenant_id
            AND updated_notification.id = current_notification.id
          RETURNING
            id AS reconciliation_id,
            previous_status,
            resulting_status,
            reconciled_at
        )
        SELECT
          reconciliation_id,
          previous_status,
          resulting_status,
          reconciled_at
        FROM reconciliation
      `;
    const reconciled: ProactiveNotificationReconciledRow | undefined =
      rows[0];
    if (reconciled) {
      return {
        status: 'reconciled',
        reconciliationId: reconciled.reconciliation_id,
        previousStatus: reconciled.previous_status,
        currentStatus: reconciled.resulting_status,
        updatedAt: toDate(reconciled.reconciled_at),
      };
    }

    const existing: ProactiveNotificationStateRow | undefined =
      (await this.sql<ProactiveNotificationStateRow[]>`
        SELECT status, updated_at
        FROM proactive_sales_notifications
        WHERE tenant_id = ${input.tenantId}::uuid
          AND id = ${input.notificationId}::uuid
        LIMIT 1
      `)[0];
    if (!existing) return { status: 'not_found' };
    return {
      status: 'conflict',
      currentStatus: existing.status,
      currentUpdatedAt: toDate(existing.updated_at),
    };
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
