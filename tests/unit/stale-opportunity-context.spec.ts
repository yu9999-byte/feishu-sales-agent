import { describe, expect, it } from 'vitest';

import {
  StaleOpportunityContextService,
  type StaleOpportunityFollowupRecord,
} from '@server/modules/insight/stale-opportunity-context.service';

const record = (
  overrides: Partial<StaleOpportunityFollowupRecord> = {},
): StaleOpportunityFollowupRecord => ({
  recordId: 'followup-1',
  opportunityRecordId: 'opportunity-1',
  communicationAt: '2026-09-20T10:00:00+08:00',
  sourceVersion: 'version-1',
  ...overrides,
});

describe('StaleOpportunityContextService', (): void => {
  const service: StaleOpportunityContextService =
    new StaleOpportunityContextService();

  it('keeps the newest effective communication for each opportunity', (): void => {
    expect(service.summarize([
      record(),
      record({
        recordId: 'followup-2',
        communicationAt: '2026-09-21T09:00:00+08:00',
        sourceVersion: 'version-2',
      }),
      record({
        recordId: 'followup-3',
        opportunityRecordId: 'opportunity-2',
        communicationAt: '2026-09-19T09:00:00+08:00',
        sourceVersion: 'version-3',
      }),
    ])).toEqual([
      {
        opportunityRecordId: 'opportunity-1',
        followupRecordId: 'followup-2',
        lastEffectiveFollowupAt: '2026-09-21T01:00:00.000Z',
        followupVersion: 'version-2',
      },
      {
        opportunityRecordId: 'opportunity-2',
        followupRecordId: 'followup-3',
        lastEffectiveFollowupAt: '2026-09-19T01:00:00.000Z',
        followupVersion: 'version-3',
      },
    ]);
  });

  it('skips records without an opportunity, communication time, or source', (): void => {
    expect(service.summarize([
      record({ opportunityRecordId: null }),
      record({ communicationAt: null }),
      record({ sourceVersion: null }),
      record({ communicationAt: '2026-09-20' }),
      record({ communicationAt: 'not-a-date' }),
    ])).toEqual([]);
  });

  it('does not replace a newer communication with an older record', (): void => {
    expect(service.summarize([
      record({
        recordId: 'followup-new',
        communicationAt: '2026-09-22T09:00:00+08:00',
        sourceVersion: 'version-new',
      }),
      record({
        recordId: 'followup-old',
        communicationAt: '2026-09-18T09:00:00+08:00',
        sourceVersion: 'version-old',
      }),
    ])).toEqual([{
      opportunityRecordId: 'opportunity-1',
      followupRecordId: 'followup-new',
      lastEffectiveFollowupAt: '2026-09-22T01:00:00.000Z',
      followupVersion: 'version-new',
    }]);
  });

  it('returns an empty result when no record is effective', (): void => {
    expect(service.summarize([])).toEqual([]);
  });
});
