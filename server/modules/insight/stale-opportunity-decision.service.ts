type OpportunityStatus = 'active' | 'won' | 'lost' | 'closed' | 'unknown';
type TaskReadStatus = 'complete' | 'limited' | 'unavailable';

interface EffectiveFollowup {
  recordId: string;
  occurredAt: string;
  version: string;
}

interface StaleOpportunityInput {
  enabled: boolean;
  tenantId: string;
  timezone: string;
  opportunityRecordId: string;
  opportunityName: string;
  opportunityStatus: OpportunityStatus;
  ownerOpenId: string;
  recipientOpenId: string;
  lastFollowup: EffectiveFollowup | null;
  taskReadStatus: TaskReadStatus;
  hasRelevantOpenTask: boolean;
  now: Date;
}

type StaleOpportunityReason =
  | 'disabled'
  | 'unverified_opportunity'
  | 'inactive'
  | 'owner_mismatch'
  | 'unverified_followup'
  | 'not_stale'
  | 'task_unverified'
  | 'task_already_open'
  | 'invalid_timezone'
  | 'quiet_hours'
  | 'stale_followup';

interface StaleOpportunityEvidence {
  opportunityRecordId: string;
  opportunityName: string;
  ownerOpenId: string;
  followupRecordId: string;
  lastEffectiveFollowupAt: string;
  followupVersion: string;
}

interface StaleOpportunityDecision {
  status: 'eligible' | 'deferred' | 'skipped';
  reason: StaleOpportunityReason;
  evidence: StaleOpportunityEvidence | null;
}

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
const OFFSET_DATE_TIME =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/u;

const skip = (reason: StaleOpportunityReason): StaleOpportunityDecision => ({
  status: 'skipped', reason, evidence: null,
});

class StaleOpportunityDecisionService {
  decide(input: StaleOpportunityInput): StaleOpportunityDecision {
    if (!input.enabled) return skip('disabled');
    if (!input.tenantId.trim() || !input.opportunityRecordId.trim() ||
      !input.opportunityName.trim() || !Number.isFinite(input.now.getTime())) {
      return skip('unverified_opportunity');
    }
    if (input.opportunityStatus !== 'active') return skip('inactive');
    if (!input.ownerOpenId.trim() ||
      input.ownerOpenId !== input.recipientOpenId) {
      return skip('owner_mismatch');
    }

    const followup: EffectiveFollowup | null = input.lastFollowup;
    if (!followup?.recordId.trim() || !followup.version.trim() ||
      !OFFSET_DATE_TIME.test(followup.occurredAt)) {
      return skip('unverified_followup');
    }
    const occurredAt: number = Date.parse(followup.occurredAt);
    const now: number = input.now.getTime();
    if (!Number.isFinite(occurredAt) || occurredAt > now) {
      return skip('unverified_followup');
    }
    if (now - occurredAt <= SEVEN_DAYS_MS) return skip('not_stale');
    if (input.taskReadStatus !== 'complete') return skip('task_unverified');
    if (input.hasRelevantOpenTask) return skip('task_already_open');

    let parts: Intl.DateTimeFormatPart[];
    try {
      parts = new Intl.DateTimeFormat('en-US', {
        timeZone: input.timezone,
        weekday: 'short',
        hour: '2-digit',
        hourCycle: 'h23',
      }).formatToParts(input.now);
    } catch (_error: unknown) {
      return skip('invalid_timezone');
    }
    const weekday: string | undefined = parts.find(
      (part: Intl.DateTimeFormatPart): boolean => part.type === 'weekday',
    )?.value;
    const hour: number = Number(parts.find(
      (part: Intl.DateTimeFormatPart): boolean => part.type === 'hour',
    )?.value);
    if (!weekday || !Number.isInteger(hour)) return skip('invalid_timezone');
    if (weekday === 'Sat' || weekday === 'Sun' || hour < 9 || hour >= 18) {
      return { status: 'deferred', reason: 'quiet_hours', evidence: null };
    }

    return {
      status: 'eligible',
      reason: 'stale_followup',
      evidence: {
        opportunityRecordId: input.opportunityRecordId,
        opportunityName: input.opportunityName,
        ownerOpenId: input.ownerOpenId,
        followupRecordId: followup.recordId,
        lastEffectiveFollowupAt: new Date(occurredAt).toISOString(),
        followupVersion: followup.version,
      },
    };
  }
}

export { StaleOpportunityDecisionService };
export type {
  EffectiveFollowup,
  StaleOpportunityDecision,
  StaleOpportunityEvidence,
  StaleOpportunityInput,
  StaleOpportunityReason,
};
