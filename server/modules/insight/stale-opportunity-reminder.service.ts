import type {
  StaleOpportunityEvidence,
} from './stale-opportunity-decision.service';

type StaleOpportunityReminderKind = 'stale_followup';
type StaleOpportunityReminderClaimSkip =
  | 'cooling_down'
  | 'in_flight'
  | 'retry_scheduled'
  | 'delivery_unknown';

interface StaleOpportunityReminderKey {
  tenantId: string;
  opportunityRecordId: string;
  followupVersion: string;
  reminderKind: StaleOpportunityReminderKind;
}

interface StaleOpportunityReminderClaimInput
extends StaleOpportunityReminderKey {
  opportunityName: string;
  ownerOpenId: string;
  now: Date;
  claimDurationMs: number;
  cooldownMs: number;
}

type StaleOpportunityReminderClaimResult =
  | {
      status: 'claimed';
      claimToken: string;
      attemptCount: number;
    }
  | {
      status: Exclude<StaleOpportunityReminderClaimSkip, 'delivery_unknown'>;
      retryAt: Date;
    }
  | {
      status: 'delivery_unknown';
    };

interface StaleOpportunityReminderDispatchInput
extends StaleOpportunityReminderKey {
  claimToken: string;
  startedAt: Date;
}

interface StaleOpportunityReminderMarkSentInput
extends StaleOpportunityReminderKey {
  claimToken: string;
  messageId: string;
  sentAt: Date;
}

interface StaleOpportunityReminderMarkFailedInput
extends StaleOpportunityReminderKey {
  claimToken: string;
  failedAt: Date;
  retryAt: Date;
  failureCode: string;
  failureMessage: string;
}

interface StaleOpportunityReminderMarkUnknownInput
extends StaleOpportunityReminderKey {
  claimToken: string;
  failedAt: Date;
  failureCode: string;
  failureMessage: string;
}

interface StaleOpportunityReminderStore {
  claim(
    input: StaleOpportunityReminderClaimInput,
  ): Promise<StaleOpportunityReminderClaimResult>;
  markDispatchStarted(
    input: StaleOpportunityReminderDispatchInput,
  ): Promise<boolean>;
  markSent(input: StaleOpportunityReminderMarkSentInput): Promise<boolean>;
  markFailed(input: StaleOpportunityReminderMarkFailedInput): Promise<boolean>;
  markDeliveryUnknown(
    input: StaleOpportunityReminderMarkUnknownInput,
  ): Promise<boolean>;
}

interface StaleOpportunityReminderUncertainRecord {
  tenantId: string;
  opportunityRecordId: string;
  followupVersion: string;
  reminderKind: StaleOpportunityReminderKind;
  opportunityName: string;
  ownerOpenId: string;
  attemptCount: number;
  dispatchStartedAt: string | null;
  failureCode: string | null;
  failureMessage: string | null;
  updatedAt: string;
}

interface StaleOpportunityReminderUncertainReader {
  listUncertain(
    input: {
      tenantId?: string;
      limit?: number;
    },
  ): Promise<StaleOpportunityReminderUncertainRecord[]>;
}

type StaleOpportunityReminderReconciliationDecision =
  | 'confirm_sent'
  | 'authorize_retry'
  | 'keep_frozen';

interface StaleOpportunityReminderReconcileInput
extends StaleOpportunityReminderKey {
  operatorMemberId: string;
  expectedUpdatedAt: Date;
  decision: StaleOpportunityReminderReconciliationDecision;
  note: string;
  messageId?: string;
  sentAt?: Date;
  reconciledAt: Date;
}

type StaleOpportunityReminderReconcileResult =
  | {
      status: 'reconciled';
      reconciliationId: string;
      previousStatus: 'uncertain';
      currentStatus: 'sent' | 'failed' | 'uncertain';
      updatedAt: Date;
    }
  | {
      status: 'conflict';
      currentStatus: 'claimed' | 'dispatching' | 'sent' | 'failed' |
        'uncertain';
      currentUpdatedAt: Date;
    }
  | {
      status: 'not_found';
    };

interface StaleOpportunityReminderReconciler {
  reconcile(
    input: StaleOpportunityReminderReconcileInput,
  ): Promise<StaleOpportunityReminderReconcileResult>;
}

interface StaleOpportunityReminderMessage {
  tenantId: string;
  recipientOpenId: string;
  opportunityRecordId: string;
  opportunityName: string;
  followupRecordId: string;
  lastEffectiveFollowupAt: string;
  suggestedAction: string;
  idempotencyKey: string;
}

interface StaleOpportunityReminderSender {
  send(
    message: StaleOpportunityReminderMessage,
  ): Promise<{ messageId: string }>;
}

interface StaleOpportunityReminderDeliveryInput {
  enabled?: boolean;
  tenantId: string;
  recipientOpenId: string;
  evidence: StaleOpportunityEvidence;
  now?: Date;
}

type StaleOpportunityReminderDeliveryResult =
  | {
      status: 'sent';
      reason: 'delivered';
      messageId: string;
    }
  | {
      status: 'skipped';
      reason: Exclude<StaleOpportunityReminderClaimSkip, 'delivery_unknown'>;
      retryAt: string;
    }
  | {
      status: 'skipped';
      reason: 'disabled' | 'owner_mismatch' | 'invalid_evidence' |
        'delivery_unknown';
    }
  | {
      status: 'failed';
      reason: 'delivery_failed';
      retryAt: string;
    }
  | {
      status: 'failed';
      reason: 'delivery_unknown' | 'finalization_conflict';
    };

const CLAIM_DURATION_MS: number = 5 * 60 * 1_000;
const STALE_THRESHOLD_MS: number = 7 * 24 * 60 * 60 * 1_000;
const COOLDOWN_MS: number = 7 * 24 * 60 * 60 * 1_000;
const RETRY_DELAY_MS: number = 15 * 60 * 1_000;
const REMINDER_KIND: StaleOpportunityReminderKind = 'stale_followup';
const SUGGESTED_ACTION: string = '核对客户进展并确认下一步跟进安排';
const OFFSET_DATE_TIME: RegExp =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/u;

class RetryableStaleOpportunityReminderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RetryableStaleOpportunityReminderError';
  }
}

class StaleOpportunityReminderService {
  constructor(
    private readonly store: StaleOpportunityReminderStore,
    private readonly sender: StaleOpportunityReminderSender,
  ) {}

  async deliver(
    input: StaleOpportunityReminderDeliveryInput,
  ): Promise<StaleOpportunityReminderDeliveryResult> {
    if (input.enabled !== true) {
      return { status: 'skipped', reason: 'disabled' };
    }
    const now: Date = input.now ?? new Date();
    if (!this.hasValidEvidence(input, now)) {
      return { status: 'skipped', reason: 'invalid_evidence' };
    }
    if (input.evidence.ownerOpenId !== input.recipientOpenId) {
      return { status: 'skipped', reason: 'owner_mismatch' };
    }

    const key: StaleOpportunityReminderKey = {
      tenantId: input.tenantId,
      opportunityRecordId: input.evidence.opportunityRecordId,
      followupVersion: input.evidence.followupVersion,
      reminderKind: REMINDER_KIND,
    };
    const claim: StaleOpportunityReminderClaimResult =
      await this.store.claim({
        ...key,
        opportunityName: input.evidence.opportunityName,
        ownerOpenId: input.evidence.ownerOpenId,
        now,
        claimDurationMs: CLAIM_DURATION_MS,
        cooldownMs: COOLDOWN_MS,
      });
    if (claim.status !== 'claimed') {
      if (claim.status === 'delivery_unknown') {
        return { status: 'skipped', reason: 'delivery_unknown' };
      }
      return {
        status: 'skipped',
        reason: claim.status,
        retryAt: claim.retryAt.toISOString(),
      };
    }

    let dispatchStarted: boolean;
    try {
      dispatchStarted = await this.store.markDispatchStarted({
        ...key,
        claimToken: claim.claimToken,
        startedAt: now,
      });
    } catch (_error: unknown) {
      return { status: 'failed', reason: 'finalization_conflict' };
    }
    if (!dispatchStarted) {
      return { status: 'failed', reason: 'finalization_conflict' };
    }

    let sent: { messageId: string };
    try {
      sent = await this.sender.send({
        tenantId: input.tenantId,
        recipientOpenId: input.recipientOpenId,
        opportunityRecordId: input.evidence.opportunityRecordId,
        opportunityName: input.evidence.opportunityName,
        followupRecordId: input.evidence.followupRecordId,
        lastEffectiveFollowupAt: input.evidence.lastEffectiveFollowupAt,
        suggestedAction: SUGGESTED_ACTION,
        idempotencyKey: [
          key.tenantId,
          key.reminderKind,
          key.opportunityRecordId,
          key.followupVersion,
        ].join(':'),
      });
      if (!sent.messageId.trim()) {
        throw new Error('Reminder sender returned an empty message ID');
      }
    } catch (error: unknown) {
      return this.handleDeliveryFailure(key, claim.claimToken, now, error);
    }

    let finalized: boolean;
    try {
      finalized = await this.store.markSent({
        ...key,
        claimToken: claim.claimToken,
        messageId: sent.messageId,
        sentAt: now,
      });
    } catch (_error: unknown) {
      return { status: 'failed', reason: 'delivery_unknown' };
    }
    if (!finalized) {
      return { status: 'failed', reason: 'finalization_conflict' };
    }
    return {
      status: 'sent',
      reason: 'delivered',
      messageId: sent.messageId,
    };
  }

  private async handleDeliveryFailure(
    key: StaleOpportunityReminderKey,
    claimToken: string,
    now: Date,
    error: unknown,
  ): Promise<StaleOpportunityReminderDeliveryResult> {
    const failureMessage: string = error instanceof Error
      ? error.message.slice(0, 1_000)
      : 'Unknown reminder delivery failure';
    if (error instanceof RetryableStaleOpportunityReminderError) {
      const retryAt: Date = new Date(now.getTime() + RETRY_DELAY_MS);
      const finalized: boolean = await this.store.markFailed({
        ...key,
        claimToken,
        failedAt: now,
        retryAt,
        failureCode: 'REMINDER_DELIVERY_FAILED',
        failureMessage,
      });
      return finalized
        ? {
            status: 'failed',
            reason: 'delivery_failed',
            retryAt: retryAt.toISOString(),
          }
        : { status: 'failed', reason: 'finalization_conflict' };
    }

    const finalized: boolean = await this.store.markDeliveryUnknown({
      ...key,
      claimToken,
      failedAt: now,
      failureCode: 'REMINDER_DELIVERY_UNKNOWN',
      failureMessage,
    });
    return finalized
      ? { status: 'failed', reason: 'delivery_unknown' }
      : { status: 'failed', reason: 'finalization_conflict' };
  }

  private hasValidEvidence(
    input: StaleOpportunityReminderDeliveryInput,
    now: Date,
  ): boolean {
    const evidence: StaleOpportunityEvidence = input.evidence;
    const occurredAt: number = Date.parse(evidence.lastEffectiveFollowupAt);
    return Boolean(
      input.tenantId.trim() &&
      input.recipientOpenId.trim() &&
      evidence.opportunityRecordId.trim() &&
      evidence.opportunityName.trim() &&
      evidence.ownerOpenId.trim() &&
      evidence.followupRecordId.trim() &&
      evidence.followupVersion.trim() &&
      OFFSET_DATE_TIME.test(evidence.lastEffectiveFollowupAt) &&
      Number.isFinite(occurredAt) &&
      Number.isFinite(now.getTime()) &&
      now.getTime() - occurredAt > STALE_THRESHOLD_MS,
    );
  }
}

export {
  RetryableStaleOpportunityReminderError,
  StaleOpportunityReminderService,
};
export type {
  StaleOpportunityReminderClaimInput,
  StaleOpportunityReminderClaimResult,
  StaleOpportunityReminderDeliveryInput,
  StaleOpportunityReminderDeliveryResult,
  StaleOpportunityReminderDispatchInput,
  StaleOpportunityReminderKey,
  StaleOpportunityReminderKind,
  StaleOpportunityReminderMarkFailedInput,
  StaleOpportunityReminderMarkSentInput,
  StaleOpportunityReminderMarkUnknownInput,
  StaleOpportunityReminderMessage,
  StaleOpportunityReminderReconcileInput,
  StaleOpportunityReminderReconcileResult,
  StaleOpportunityReminderReconciler,
  StaleOpportunityReminderReconciliationDecision,
  StaleOpportunityReminderSender,
  StaleOpportunityReminderStore,
  StaleOpportunityReminderUncertainReader,
  StaleOpportunityReminderUncertainRecord,
};
