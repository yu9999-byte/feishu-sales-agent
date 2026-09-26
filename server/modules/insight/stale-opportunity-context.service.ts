import type { StaleOpportunityFollowupRecord } from
  '@server/modules/agent-core/agent.types';

interface LatestOpportunityFollowup {
  opportunityRecordId: string;
  followupRecordId: string;
  lastEffectiveFollowupAt: string;
  followupVersion: string;
}

const OFFSET_DATE_TIME: RegExp =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/u;

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
      if (
        previous === undefined ||
        Date.parse(normalized.lastEffectiveFollowupAt) >
          Date.parse(previous.lastEffectiveFollowupAt)
      ) {
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
    if (
      !opportunityRecordId ||
      !followupRecordId ||
      !followupVersion ||
      !OFFSET_DATE_TIME.test(communicationAt)
    ) {
      return null;
    }

    const occurredAt: number = Date.parse(communicationAt);
    if (!Number.isFinite(occurredAt)) return null;

    return {
      opportunityRecordId,
      followupRecordId,
      lastEffectiveFollowupAt: new Date(occurredAt).toISOString(),
      followupVersion,
    };
  }
}

export { StaleOpportunityContextService };
export type {
  LatestOpportunityFollowup,
  StaleOpportunityFollowupRecord,
};
