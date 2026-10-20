import { describe, expect, it } from 'vitest';
import type { TaskHistorySourceResult } from '@server/modules/agent-core/agent.types';
import { hasCompleteTaskHistory } from '@server/modules/insight/task-history-evidence';

const scope = {
  tenantId: 'tenant-a', actorOpenId: 'ou-a', taskGuids: ['guid-a'],
  since: new Date('2026-10-01T00:00:00Z'), until: new Date('2026-10-20T00:00:00Z'),
};
const source = (): TaskHistorySourceResult => ({
  coverage: 'full',
  continuity: { sourceId: 'trusted-a', tenantId: scope.tenantId, actorOpenId: scope.actorOpenId,
    taskGuids: ['guid-a'], from: scope.since.toISOString(), through: scope.until.toISOString(),
    gaps: [], hasMore: false },
  items: [{ eventId: 'event-a', guid: 'guid-a', kind: 'completed', title: '交付方案', status: 'completed',
    completedAt: '2026-10-10T00:00:00Z', occurredAt: '2026-10-10T00:01:00Z', dueAt: null, url: null,
    previousTitle: null, previousStatus: 'todo', previousCompletedAt: null, previousDueAt: null,
    relatedTaskGuid: null, relation: null }],
});

describe('trusted task history continuity', () => {
  it('accepts an exact, exhausted and continuous scope', () => {
    expect(hasCompleteTaskHistory(source(), scope)).toBe(true);
  });
  it('requires more than a full coverage label', () => {
    expect(hasCompleteTaskHistory({ coverage: 'full', items: [] }, scope)).toBe(false);
  });
  it.each(['tenantId', 'actorOpenId', 'sourceId', 'from', 'through'] as const)(
    'rejects invalid proof field %s', (field) => {
      const result = source(); result.continuity![field] = field === 'sourceId' ? '' : 'invalid';
      expect(hasCompleteTaskHistory(result, scope)).toBe(false);
    },
  );
  it('rejects incomplete, extra or duplicated GUID scope, gaps and remaining pages', () => {
    for (const taskGuids of [[], ['guid-b'], ['guid-a', 'guid-b'], ['guid-a', 'guid-a']]) {
      const result = source(); result.continuity!.taskGuids = taskGuids;
      expect(hasCompleteTaskHistory(result, scope)).toBe(false);
    }
    const gaps = source(); gaps.continuity!.gaps = [{ from: '2026-10-02', through: '2026-10-03' }];
    expect(hasCompleteTaskHistory(gaps, scope)).toBe(false);
    const pages = source(); pages.continuity!.hasMore = true;
    expect(hasCompleteTaskHistory(pages, scope)).toBe(false);
  });
  it('rejects out of scope, future, invalid and contradictory events', () => {
    for (const patch of [
      { guid: 'guid-b' }, { occurredAt: 'invalid' }, { occurredAt: '2026-10-21T00:00:00Z' },
      { occurredAt: '2026-09-30T00:00:00Z' }, { completedAt: null }, { completedAt: '0' },
      { completedAt: '2026-10-11T00:00:00Z' }, { kind: 'reopened' as const },
    ]) {
      const result = source(); Object.assign(result.items[0], patch);
      expect(hasCompleteTaskHistory(result, scope)).toBe(false);
    }
    const result = source();
    result.items.push({ ...result.items[0], eventId: 'event-b', kind: 'reopened', completedAt: null, status: 'todo' });
    expect(hasCompleteTaskHistory(result, scope)).toBe(false);
  });
});
