import type {
  PlatformSessionResponse,
} from '@shared/api.interface';
import type {
  TenantIntegration,
} from '@server/modules/agent-core/agent.types';
import {
  PlatformAccessDeniedError,
} from '@server/modules/platform-shell/platform-session.service';
import type {
  StaleOpportunityEvidence,
} from './stale-opportunity-decision.service';
import type {
  StaleOpportunityReminderDeliveryInput,
  StaleOpportunityReminderDeliveryResult,
} from './stale-opportunity-reminder.service';
import type {
  StaleOpportunityScanResult,
} from './stale-opportunity-scan.service';

interface StaleOpportunityReminderControlReader {
  resolveTenantById(tenantId: string): Promise<TenantIntegration | null>;
}

interface StaleOpportunityReminderSessionReader {
  getSessionByMembership(
    tenantId: string,
    memberId: string,
    occurredAt?: Date,
  ): Promise<PlatformSessionResponse>;
}

interface StaleOpportunityReminderScanner {
  scan(input: {
    enabled?: boolean;
    integration: TenantIntegration;
    actorOpenId: string;
    timezone: string;
    now?: Date;
  }): Promise<StaleOpportunityScanResult>;
}

interface StaleOpportunityReminderDeliveryPort {
  deliver(
    input: StaleOpportunityReminderDeliveryInput,
  ): Promise<StaleOpportunityReminderDeliveryResult>;
}

interface StaleOpportunityReminderPreparationInput {
  enabled?: boolean;
  tenantId: string;
  memberId: string;
  evidence: StaleOpportunityEvidence;
  now?: Date;
}

type StaleOpportunityReminderPreparationSkipReason =
  | 'disabled'
  | 'tenant_unavailable'
  | 'authorization_denied'
  | 'permission_missing'
  | 'source_unverified'
  | 'candidate_changed';

type StaleOpportunityReminderPreparationResult =
  | StaleOpportunityReminderDeliveryResult
  | {
      status: 'skipped';
      reason: StaleOpportunityReminderPreparationSkipReason;
    };

class StaleOpportunityReminderCoordinatorService {
  constructor(
    private readonly control: StaleOpportunityReminderControlReader,
    private readonly sessions: StaleOpportunityReminderSessionReader,
    private readonly scanner: StaleOpportunityReminderScanner,
    private readonly reminders: StaleOpportunityReminderDeliveryPort,
  ) {}

  async prepareAndDeliver(
    input: StaleOpportunityReminderPreparationInput,
  ): Promise<StaleOpportunityReminderPreparationResult> {
    if (input.enabled !== true) {
      return { status: 'skipped', reason: 'disabled' };
    }
    if (!input.tenantId.trim() || !input.memberId.trim()) {
      return { status: 'skipped', reason: 'source_unverified' };
    }

    const now: Date = input.now ?? new Date();
    const integration: TenantIntegration | null =
      await this.resolveIntegration(input.tenantId);
    if (integration === null || integration.status !== 'active') {
      return { status: 'skipped', reason: 'tenant_unavailable' };
    }
    if (integration.tenantId !== input.tenantId) {
      return { status: 'skipped', reason: 'source_unverified' };
    }

    const sessionResult: PlatformSessionResponse | 'authorization_denied' |
      'source_unverified' = await this.resolveSession(input, now);
    if (sessionResult === 'authorization_denied') {
      return { status: 'skipped', reason: 'authorization_denied' };
    }
    if (sessionResult === 'source_unverified') {
      return { status: 'skipped', reason: 'source_unverified' };
    }
    if (sessionResult.roles.length === 0) {
      return { status: 'skipped', reason: 'authorization_denied' };
    }
    if (!sessionResult.permissions.includes('review:read-personal')) {
      return { status: 'skipped', reason: 'permission_missing' };
    }
    if (!this.sessionMatches(input, sessionResult)) {
      return { status: 'skipped', reason: 'source_unverified' };
    }

    const scan: StaleOpportunityScanResult | null = await this.scanCurrent(
      integration,
      sessionResult,
      now,
    );
    if (scan === null || scan.status !== 'complete') {
      return { status: 'skipped', reason: 'source_unverified' };
    }

    const current: StaleOpportunityEvidence[] = scan.candidates.filter(
      (candidate: StaleOpportunityEvidence): boolean =>
        candidate.opportunityRecordId === input.evidence.opportunityRecordId,
    );
    if (
      current.length !== 1 ||
      !this.evidenceMatches(input.evidence, current[0])
    ) {
      return { status: 'skipped', reason: 'candidate_changed' };
    }

    return this.reminders.deliver({
      enabled: true,
      tenantId: input.tenantId,
      recipientOpenId: sessionResult.member.feishuOpenId,
      evidence: current[0],
      now,
    });
  }

  private async resolveIntegration(
    tenantId: string,
  ): Promise<TenantIntegration | null> {
    try {
      return await this.control.resolveTenantById(tenantId);
    } catch (_error: unknown) {
      return null;
    }
  }

  private async resolveSession(
    input: StaleOpportunityReminderPreparationInput,
    now: Date,
  ): Promise<PlatformSessionResponse | 'authorization_denied' |
    'source_unverified'> {
    try {
      return await this.sessions.getSessionByMembership(
        input.tenantId,
        input.memberId,
        now,
      );
    } catch (error: unknown) {
      return error instanceof PlatformAccessDeniedError
        ? 'authorization_denied'
        : 'source_unverified';
    }
  }

  private async scanCurrent(
    integration: TenantIntegration,
    session: PlatformSessionResponse,
    now: Date,
  ): Promise<StaleOpportunityScanResult | null> {
    try {
      return await this.scanner.scan({
        enabled: true,
        integration,
        actorOpenId: session.member.feishuOpenId,
        timezone: session.tenant.timezone,
        now,
      });
    } catch (_error: unknown) {
      return null;
    }
  }

  private sessionMatches(
    input: StaleOpportunityReminderPreparationInput,
    session: PlatformSessionResponse,
  ): boolean {
    return session.tenant.id === input.tenantId &&
      session.member.id === input.memberId &&
      session.member.feishuOpenId === input.evidence.ownerOpenId;
  }

  private evidenceMatches(
    expected: StaleOpportunityEvidence,
    current: StaleOpportunityEvidence,
  ): boolean {
    return current.opportunityRecordId === expected.opportunityRecordId &&
      current.opportunityName === expected.opportunityName &&
      current.ownerOpenId === expected.ownerOpenId &&
      current.followupRecordId === expected.followupRecordId &&
      current.lastEffectiveFollowupAt === expected.lastEffectiveFollowupAt &&
      current.followupVersion === expected.followupVersion;
  }
}

export { StaleOpportunityReminderCoordinatorService };
export type {
  StaleOpportunityReminderControlReader,
  StaleOpportunityReminderDeliveryPort,
  StaleOpportunityReminderPreparationInput,
  StaleOpportunityReminderPreparationResult,
  StaleOpportunityReminderPreparationSkipReason,
  StaleOpportunityReminderScanner,
  StaleOpportunityReminderSessionReader,
};
