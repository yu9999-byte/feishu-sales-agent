import { describe, expect, it } from 'vitest';

import {
  StaleOpportunityDecisionService,
  type StaleOpportunityInput,
} from '@server/modules/insight/stale-opportunity-decision.service';

const NOW = new Date('2026-09-28T02:00:00.000Z');

const input = (
  overrides: Partial<StaleOpportunityInput> = {},
): StaleOpportunityInput => ({
  enabled: true,
  tenantId: 'tenant-1',
  timezone: 'Asia/Shanghai',
  opportunityRecordId: 'opportunity-1',
  opportunityName: '华南科技 - 销售机会',
  opportunityStatus: 'active',
  ownerOpenId: 'owner-1',
  recipientOpenId: 'owner-1',
  lastFollowup: {
    recordId: 'followup-1',
    occurredAt: '2026-09-20T02:00:00.000Z',
    version: '2026-09-20T02:00:00.000Z',
  },
  taskReadStatus: 'complete',
  hasRelevantOpenTask: false,
  now: NOW,
  ...overrides,
});

const decide = (overrides: Partial<StaleOpportunityInput> = {}) =>
  new StaleOpportunityDecisionService().decide(input(overrides));

describe('StaleOpportunityDecisionService', (): void => {
  it('returns evidence only for a verified opportunity past seven full days', (): void => {
    expect(decide()).toEqual({
      status: 'eligible',
      reason: 'stale_followup',
      evidence: {
        opportunityRecordId: 'opportunity-1',
        opportunityName: '华南科技 - 销售机会',
        ownerOpenId: 'owner-1',
        followupRecordId: 'followup-1',
        lastEffectiveFollowupAt: '2026-09-20T02:00:00.000Z',
        followupVersion: '2026-09-20T02:00:00.000Z',
      },
    });
  });

  it('requires more than seven full days and invalidates after a new followup', (): void => {
    expect(decide({ lastFollowup: {
      recordId: 'followup-2',
      occurredAt: '2026-09-21T02:00:00.000Z',
      version: 'v2',
    } }).reason).toBe('not_stale');
    expect(decide({ lastFollowup: {
      recordId: 'followup-2',
      occurredAt: '2026-09-21T02:00:00.001Z',
      version: 'v2',
    } }).reason).toBe('not_stale');
  });

  it('fails closed without a trusted per-opportunity event time', (): void => {
    expect(decide({ lastFollowup: null }).reason).toBe('unverified_followup');
    for (const occurredAt of ['2026-09-20', 'yesterday', '2026-09-29T02:00:00Z']) {
      expect(decide({ lastFollowup: {
        recordId: 'followup-1', occurredAt, version: 'v1',
      } }).reason).toBe('unverified_followup');
    }
    expect(decide({ lastFollowup: {
      recordId: 'followup-1',
      occurredAt: '2026-09-20T02:00:00Z', version: '',
    } }).reason).toBe('unverified_followup');
  });

  it('does not remind outside an active owned opportunity', (): void => {
    expect(decide({ enabled: false }).reason).toBe('disabled');
    expect(decide({ ownerOpenId: 'owner-2' }).reason).toBe('owner_mismatch');
    expect(decide({ ownerOpenId: '' }).reason).toBe('owner_mismatch');
    for (const status of ['won', 'lost', 'closed', 'unknown'] as const) {
      expect(decide({ opportunityStatus: status }).reason).toBe('inactive');
    }
  });

  it('fails closed on partial task visibility and existing relevant work', (): void => {
    expect(decide({ taskReadStatus: 'unavailable' }).reason).toBe('task_unverified');
    expect(decide({ taskReadStatus: 'limited' }).reason).toBe('task_unverified');
    expect(decide({ hasRelevantOpenTask: true }).reason).toBe('task_already_open');
  });

  it('defers outside tenant weekday business hours, including DST zones', (): void => {
    expect(decide({ now: new Date('2026-09-28T00:59:59Z') }).status)
      .toBe('deferred');
    expect(decide({
      now: new Date('2026-09-26T02:00:00Z'),
      lastFollowup: {
        recordId: 'followup-1',
        occurredAt: '2026-09-18T02:00:00Z',
        version: 'v1',
      },
    }).status)
      .toBe('deferred');
    expect(decide({ now: new Date('2026-09-28T10:00:00Z') }).status)
      .toBe('deferred');
    expect(decide({ timezone: 'Invalid/Zone' }).reason)
      .toBe('invalid_timezone');
    expect(decide({
      timezone: 'America/New_York',
      now: new Date('2026-03-09T13:00:00Z'),
      lastFollowup: {
        recordId: 'followup-1',
        occurredAt: '2026-03-01T13:00:00Z',
        version: 'v1',
      },
    }).status).toBe('eligible');
    expect(decide({
      timezone: 'America/New_York',
      now: new Date('2026-03-09T12:59:59Z'),
      lastFollowup: {
        recordId: 'followup-1',
        occurredAt: '2026-03-01T13:00:00Z',
        version: 'v1',
      },
    }).status).toBe('deferred');
  });
});
