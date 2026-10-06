import { describe, expect, it } from 'vitest';

import type { OpportunityDecisionItem } from '@shared/api.interface';
import {
  formatDecisionAmount,
  healthView,
  resolveSelectedOpportunity,
} from '../../client/src/pages/OpportunityDecisionPage/opportunity-decision-view';

const item = (recordId: string, rank: number): OpportunityDecisionItem => ({
  rank,
  recordId,
  recordUrl: null,
  name: `商机${rank}`,
  customerRecordId: null,
  customerName: null,
  lifecycleStatus: 'active',
  expectedAmount: null,
  progress: null,
  lastFollowupAt: null,
  lastFollowupSummary: null,
  nextAction: null,
  dueAt: null,
  health: 'needs_attention',
  priorityScore: 1,
  risks: [],
  gaps: [],
  recommendation: null,
  taskPromises: [],
  evidence: [],
});

describe('opportunity decision view helpers', (): void => {
  it('maps health to stable product language', (): void => {
    expect(healthView.critical.label).toBe('立即处理');
    expect(healthView.at_risk.label).toBe('存在风险');
    expect(healthView.needs_attention.label).toBe('需要关注');
    expect(healthView.on_track.label).toBe('正常推进');
  });

  it('keeps unknown amounts visibly unknown', (): void => {
    expect(formatDecisionAmount(null)).toBe('金额未提供');
    expect(formatDecisionAmount(500000)).toContain('500,000');
  });

  it('falls back to the first priority when selection is stale', (): void => {
    const priorities: OpportunityDecisionItem[] = [item('a', 1), item('b', 2)];

    expect(resolveSelectedOpportunity(priorities, 'b')?.recordId).toBe('b');
    expect(resolveSelectedOpportunity(priorities, 'missing')?.recordId).toBe('a');
    expect(resolveSelectedOpportunity([], 'a')).toBeNull();
  });
});
