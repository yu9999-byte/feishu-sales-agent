interface ProactiveNotificationSection {
  title: string;
  lines: string[];
}

type ProactiveNotificationKind =
  | 'task_action'
  | 'opportunity_risk'
  | 'daily_report'
  | 'weekly_personal'
  | 'weekly_team';

interface ProactiveNotificationMessage {
  tenantId: string;
  recipientMemberId: string;
  recipientOpenId: string;
  kind: ProactiveNotificationKind;
  notificationKey: string;
  subjectKey: string;
  title: string;
  subtitle: string;
  sections: ProactiveNotificationSection[];
  actionLabel?: string;
  actionUrl?: string;
  payloadFingerprint: string;
}

interface ProactiveNotificationClaimInput {
  tenantId: string;
  recipientMemberId: string;
  recipientOpenId: string;
  kind: ProactiveNotificationKind;
  notificationKey: string;
  subjectKey: string;
  payloadFingerprint: string;
  now: Date;
  claimDurationMs: number;
  maxAttempts: number;
}

type ProactiveNotificationClaimResult =
  | { status: 'claimed'; claimToken: string; attemptCount: number }
  | { status: 'in_flight' | 'already_sent' | 'delivery_unknown' }
  | { status: 'retry_scheduled' | 'attempts_exhausted'; retryAt?: Date };

interface ProactiveNotificationStateInput {
  tenantId: string;
  recipientMemberId: string;
  kind: ProactiveNotificationKind;
  notificationKey: string;
  claimToken: string;
}

interface ProactiveNotificationStore {
  claim(
    input: ProactiveNotificationClaimInput,
  ): Promise<ProactiveNotificationClaimResult>;
  markDispatchStarted(
    input: ProactiveNotificationStateInput & { startedAt: Date },
  ): Promise<boolean>;
  markSent(
    input: ProactiveNotificationStateInput & {
      messageId: string;
      sentAt: Date;
    },
  ): Promise<boolean>;
  markFailed(
    input: ProactiveNotificationStateInput & {
      failedAt: Date;
      retryAt: Date;
      failureCode: string;
      failureMessage: string;
    },
  ): Promise<boolean>;
  markDeliveryUnknown(
    input: ProactiveNotificationStateInput & {
      failedAt: Date;
      failureCode: string;
      failureMessage: string;
    },
  ): Promise<boolean>;
}

interface ProactiveNotificationSender {
  send(message: ProactiveNotificationMessage): Promise<{ messageId: string }>;
}

interface ProactiveNotificationDeliveryInput {
  enabled: boolean;
  message: ProactiveNotificationMessage;
  now?: Date;
}

type ProactiveNotificationDeliveryResult =
  | { status: 'sent'; reason: 'delivered'; messageId: string }
  | {
      status: 'skipped';
      reason:
        | 'disabled'
        | 'in_flight'
        | 'already_sent'
        | 'retry_scheduled'
        | 'attempts_exhausted'
        | 'delivery_unknown';
      retryAt?: string;
    }
  | {
      status: 'failed';
      reason: 'delivery_failed' | 'delivery_unknown' | 'state_conflict';
      retryAt?: string;
    };

class RetryableProactiveNotificationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RetryableProactiveNotificationError';
  }
}

const CLAIM_DURATION_MS: number = 5 * 60 * 1000;
const RETRY_DELAY_MS: number = 5 * 60 * 1000;
const MAX_ATTEMPTS: number = 3;

class ProactiveNotificationDeliveryService {
  constructor(
    private readonly store: ProactiveNotificationStore,
    private readonly sender: ProactiveNotificationSender,
  ) {}

  async deliver(
    input: ProactiveNotificationDeliveryInput,
  ): Promise<ProactiveNotificationDeliveryResult> {
    if (!input.enabled) return { status: 'skipped', reason: 'disabled' };
    const now: Date = input.now ?? new Date();
    const claim: ProactiveNotificationClaimResult = await this.store.claim({
      tenantId: input.message.tenantId,
      recipientMemberId: input.message.recipientMemberId,
      recipientOpenId: input.message.recipientOpenId,
      kind: input.message.kind,
      notificationKey: input.message.notificationKey,
      subjectKey: input.message.subjectKey,
      payloadFingerprint: input.message.payloadFingerprint,
      now,
      claimDurationMs: CLAIM_DURATION_MS,
      maxAttempts: MAX_ATTEMPTS,
    });
    if (claim.status !== 'claimed') {
      const retryAt: Date | undefined = 'retryAt' in claim
        ? claim.retryAt
        : undefined;
      return {
        status: 'skipped',
        reason: claim.status,
        ...(retryAt ? { retryAt: retryAt.toISOString() } : {}),
      };
    }
    const state = {
      tenantId: input.message.tenantId,
      recipientMemberId: input.message.recipientMemberId,
      kind: input.message.kind,
      notificationKey: input.message.notificationKey,
      claimToken: claim.claimToken,
    };
    const dispatchStarted: boolean = await this.store.markDispatchStarted({
      ...state,
      startedAt: now,
    });
    if (!dispatchStarted) {
      return { status: 'failed', reason: 'state_conflict' };
    }

    try {
      const result: { messageId: string } =
        await this.sender.send(input.message);
      const marked: boolean = await this.store.markSent({
        ...state,
        messageId: result.messageId,
        sentAt: now,
      });
      return marked
        ? { status: 'sent', reason: 'delivered', messageId: result.messageId }
        : { status: 'failed', reason: 'state_conflict' };
    } catch (error: unknown) {
      const failureMessage: string = this.safeMessage(error);
      if (error instanceof RetryableProactiveNotificationError) {
        const retryAt: Date = new Date(now.getTime() + RETRY_DELAY_MS);
        const marked: boolean = await this.store.markFailed({
          ...state,
          failedAt: now,
          retryAt,
          failureCode: 'PROACTIVE_DELIVERY_FAILED',
          failureMessage,
        });
        return marked
          ? {
              status: 'failed',
              reason: 'delivery_failed',
              retryAt: retryAt.toISOString(),
            }
          : { status: 'failed', reason: 'state_conflict' };
      }
      const marked: boolean = await this.store.markDeliveryUnknown({
        ...state,
        failedAt: now,
        failureCode: 'PROACTIVE_DELIVERY_UNKNOWN',
        failureMessage,
      });
      return marked
        ? { status: 'failed', reason: 'delivery_unknown' }
        : { status: 'failed', reason: 'state_conflict' };
    }
  }

  private safeMessage(error: unknown): string {
    const message: string = error instanceof Error
      ? error.message
      : 'Unknown proactive notification failure';
    return message.replace(/[\r\n\t]+/gu, ' ').slice(0, 500);
  }
}

export {
  ProactiveNotificationDeliveryService,
  RetryableProactiveNotificationError,
};
export type {
  ProactiveNotificationClaimInput,
  ProactiveNotificationClaimResult,
  ProactiveNotificationDeliveryInput,
  ProactiveNotificationDeliveryResult,
  ProactiveNotificationKind,
  ProactiveNotificationMessage,
  ProactiveNotificationSection,
  ProactiveNotificationSender,
  ProactiveNotificationStateInput,
  ProactiveNotificationStore,
};
