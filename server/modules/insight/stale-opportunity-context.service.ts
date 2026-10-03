import { Injectable } from '@nestjs/common';

import type { StaleOpportunityFollowupRecord } from
  '@server/modules/agent-core/agent.types';

interface LatestOpportunityFollowup {
  opportunityRecordId: string;
  followupRecordId: string;
  lastEffectiveFollowupAt: string | null;
  followupVersion: string | null;
  timeVerified: boolean;
}

const OFFSET_DATE_TIME: RegExp =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/u;

@Injectable()
class StaleOpportunityContextService {
  summarize(
    records: readonly StaleOpportunityFollowupRecord[],
  ): LatestOpportunityFollowup[] {
    const latestByOpportunity: Map<string, LatestOpportunityFollowup> =
      new Map();

    for (const record of records) {
      const normalized: LatestOpportunityFollowup | null =
        this.normalize(record);
      if (normalized === null) continue;

      const previous: LatestOpportunityFollowup | undefined =
        latestByOpportunity.get(normalized.opportunityRecordId);
      if (this.shouldReplace(previous, normalized)) {
        latestByOpportunity.set(normalized.opportunityRecordId, normalized);
      }
    }

    return [...latestByOpportunity.values()].sort(
      (left: LatestOpportunityFollowup, right: LatestOpportunityFollowup): number =>
        left.opportunityRecordId.localeCompare(right.opportunityRecordId),
    );
  }

  private normalize(
    record: StaleOpportunityFollowupRecord,
  ): LatestOpportunityFollowup | null {
    const opportunityRecordId: string = record.opportunityRecordId?.trim() ?? '';
    const followupRecordId: string = record.recordId.trim();
    const communicationAt: string = record.communicationAt?.trim() ?? '';
    const followupVersion: string = record.sourceVersion?.trim() ?? '';
    if (!opportunityRecordId || !followupRecordId) {
      return null;
    }

    if (!followupVersion || !OFFSET_DATE_TIME.test(communicationAt)) {
      return {
        opportunityRecordId,
        followupRecordId,
        lastEffectiveFollowupAt: null,
        followupVersion: followupVersion || null,
        timeVerified: false,
      };
    }

    const occurredAt: number = Date.parse(communicationAt);
    if (!Number.isFinite(occurredAt)) {
      return {
        opportunityRecordId,
        followupRecordId,
        lastEffectiveFollowupAt: null,
        followupVersion,
        timeVerified: false,
      };
    }

    return {
      opportunityRecordId,
      followupRecordId,
      lastEffectiveFollowupAt: new Date(occurredAt).toISOString(),
      followupVersion,
      timeVerified: true,
    };
  }

  private shouldReplace(
    previous: LatestOpportunityFollowup | undefined,
    next: LatestOpportunityFollowup,
  ): boolean {
    if (previous === undefined) return true;
    if (previous.timeVerified !== next.timeVerified) {
      return !next.timeVerified;
    }
    if (!next.timeVerified || previous.lastEffectiveFollowupAt === null ||
        next.lastEffectiveFollowupAt === null) {
      return next.followupRecordId.localeCompare(previous.followupRecordId) > 0;
    }
    return Date.parse(next.lastEffectiveFollowupAt) >
      Date.parse(previous.lastEffectiveFollowupAt);
  }
}

export { StaleOpportunityContextService };
export type {
  LatestOpportunityFollowup,
  StaleOpportunityFollowupRecord,
};
