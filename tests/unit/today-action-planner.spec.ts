import { describe, expect, it } from 'vitest';
import { buildTodayActions } from '@server/modules/insight/today-action-planner';
import type { OpportunityDecisionItem } from '@shared/api.interface';

describe('today action evidence planner', () => {
  it('omits executable source URLs', () => {
    const items = buildTodayActions({ referenceDate: '2026-10-16', opportunities: [], followups: [],
      tasks: [{ guid: 't', title: '回访', status: 'todo', completedAt: null,
        dueAt: '2026-10-16T00:00:00Z', dueDate: '2026-10-16', daysUntilDue: 0,
        url: 'javascript:alert(1)', category: 'due_today', priority: 'high', suggestedAction: '回访' }],
    });
    expect(items[0].sourceUrl).toBeNull();
  });
  it('uses tenant timezone for opportunity recommendation dates', () => {
    const opportunity: OpportunityDecisionItem = { rank: 1, recordId: 'o', recordUrl: null,
      name: '试点', customerRecordId: 'c', customerName: '客户', lifecycleStatus: 'active',
      expectedAmount: null, progress: null, lastFollowupAt: null, lastFollowupSummary: null,
      nextAction: null, dueAt: null, health: 'at_risk', priorityScore: 1,
      risks: [{ code: 'followup_stale', severity: 'high', title: '停滞', detail: '14天', evidenceIds: ['e'] }],
      gaps: [], taskPromises: [], evidence: [{ id: 'e', kind: 'opportunity', label: '记录',
        value: '14天未跟进', occurredAt: null, source: null }],
      recommendation: { action: '联系客户', reason: '停滞', dueAt: '2026-10-15T18:00:00Z',
        evidenceIds: ['e'], requiresConfirmation: true } };
    const items = buildTodayActions({ referenceDate: '2026-10-16', timezone: 'Asia/Shanghai',
      tasks: [], followups: [], opportunities: [opportunity] });
    expect(items[0].suggestedCompletionDate).toBe('2026-10-16');
    for (const evidenceIds of [[], ['missing'], ['e', 'missing']]) {
      const unverified = buildTodayActions({ referenceDate: '2026-10-16',
        timezone: 'Asia/Shanghai', tasks: [], followups: [], opportunities: [{ ...opportunity,
          recommendation: { ...opportunity.recommendation!, action: '无证据建议',
            dueAt: '2026-10-30T18:00:00Z', evidenceIds },
        }] });
      expect(unverified[0].suggestedAction).toBe('核实并补充商机信息');
      expect(unverified[0].suggestedCompletionDate).toBe('2026-10-16');
      expect(unverified[0].reason).toContain('停滞');
    }
    expect(items[0].suggestedAction).toBe('联系客户');
    const separateEvidence = buildTodayActions({ referenceDate: '2026-10-16',
      tasks: [], followups: [], opportunities: [{ ...opportunity,
        evidence: [...opportunity.evidence, { id: 'promise', kind: 'opportunity', label: '客户约定',
          value: '明天电话确认预算', occurredAt: null, source: null }],
        recommendation: { action: '电话确认预算', reason: '客户约定', dueAt: '2026-10-17',
          evidenceIds: ['promise'], requiresConfirmation: true },
      }] });
    expect(separateEvidence[0].suggestedAction).toBe('电话确认预算');
    expect(separateEvidence[0].evidence).toContain('客户约定：明天电话确认预算');
    expect(buildTodayActions({ referenceDate: '2026-10-16', tasks: [], followups: [],
      opportunities: [{ ...opportunity, risks: [{ ...opportunity.risks[0], evidenceIds: ['missing'] }] }],
    })).toEqual([]);
  });
  it('keeps overdue and tomorrow tasks, excludes completed and distant tasks', () => {
    const task = (guid: string, daysUntilDue: number, completedAt: string | null = null) => ({
      guid, title: guid, status: 'todo', completedAt, dueAt: '2026-10-16T09:00:00+08:00',
      dueDate: '2026-10-16', daysUntilDue, url: null, category: 'due_today' as const,
      priority: 'high' as const, suggestedAction: '完成承诺',
    });
    const items = buildTodayActions({
      referenceDate: '2026-10-16', tasks: [task('late', -1), task('soon', 1),
        task('done', 0, '2026-10-15T00:00:00Z'), task('later', 3)],
      opportunities: [], followups: [],
    });
    expect(items.map((item) => item.sourceId)).toEqual(['late', 'soon']);
    expect(items.every((item) => item.reason && item.evidence.length &&
      item.suggestedAction && item.suggestedCompletionDate)).toBe(true);
  });

  it('uses explicit followup due date and customer association, deduplicating source IDs', () => {
    const followup = { recordId: 'f1', customerRecordId: 'c1', opportunityRecordId: null,
      summary: '客户要求报价', communicationAt: '2026-10-15T00:00:00Z', nextAction: '发送报价',
      dueAt: '2026-10-16T09:00:00+08:00', sourceVersion: 'v1', recordUrl: null };
    const items = buildTodayActions({ referenceDate: '2026-10-16', tasks: [], opportunities: [],
      followups: [followup, followup, { ...followup, recordId: 'orphan', customerRecordId: null }],
    });
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ kind: 'customer_followup', customerRecordId: 'c1' });
  });
});

it('uses tenant day rather than the UTC prefix for followup deadlines', () => {
  const items = buildTodayActions({ referenceDate: '2026-10-16', timezone: 'Asia/Shanghai',
    tasks: [], opportunities: [], followups: [{ recordId: 'utc', customerRecordId: 'c',
      opportunityRecordId: null, summary: '报价', communicationAt: null, nextAction: '回访',
      dueAt: '2026-10-15T18:00:00Z', sourceVersion: null, recordUrl: null }],
  });
  expect(items).toHaveLength(1);
});

it('merges stale, missing information and risk reasons with original evidence', () => {
  const items = buildTodayActions({ referenceDate: '2026-10-16', tasks: [], followups: [],
    opportunities: [{ rank: 1, recordId: 'o1', recordUrl: null, name: '试点',
      customerRecordId: 'c1', customerName: '客户', lifecycleStatus: 'active',
      expectedAmount: null, progress: null, lastFollowupAt: null, lastFollowupSummary: null,
      nextAction: null, dueAt: null, health: 'at_risk', priorityScore: 80,
      risks: [{ code: 'followup_stale', severity: 'high', title: '跟进停滞',
        detail: '超过14天', evidenceIds: ['e1'] }],
      gaps: [{ code: 'amount_missing', title: '金额缺失', detail: '待核实', evidenceIds: ['e1'] }],
      recommendation: null, taskPromises: [], evidence: [{ id: 'e1', kind: 'opportunity',
        label: '原商机', value: '最近沟通于9月', occurredAt: null, source: null }],
    }],
  });
  expect(items).toHaveLength(1);
  expect(items[0].reason).toContain('跟进停滞');
  expect(items[0].reason).toContain('金额缺失');
  expect(items[0].evidence).toEqual(['原商机：最近沟通于9月']);
});

it('rejects invalid reference dates rather than silently returning an empty day', () => {
  expect(() => buildTodayActions({ referenceDate: '2026-99-99', tasks: [],
    opportunities: [], followups: [] })).toThrow();
});

it('does not revive a completed task when the upstream completion timestamp is absent', () => {
  expect(buildTodayActions({ referenceDate: '2026-10-16', opportunities: [], followups: [],
    tasks: [{ guid: 'done', title: '完成', status: 'completed', completedAt: null,
      dueAt: '2026-10-15T00:00:00Z', dueDate: '2026-10-15', daysUntilDue: -1,
      url: null, category: 'overdue', priority: 'high', suggestedAction: '跟进' }],
  })).toEqual([]);
});

it('fails closed for invalid timezone even without business records', () => {
  expect(() => buildTodayActions({ referenceDate: '2026-10-16', timezone: 'Unknown/Zone',
    tasks: [], opportunities: [], followups: [] })).toThrow();
});

it('excludes won opportunities even if stale risk remains in a cached snapshot', () => {
  const opportunity = { rank: 1, recordId: 'closed', recordUrl: null, name: '已成交',
    customerRecordId: 'c', customerName: '客户', lifecycleStatus: 'won' as const,
    expectedAmount: 1, progress: null, lastFollowupAt: null, lastFollowupSummary: null,
    nextAction: null, dueAt: null, health: 'at_risk' as const, priorityScore: 1,
    risks: [{ code: 'followup_stale' as const, severity: 'high' as const, title: '停滞',
      detail: '旧信号', evidenceIds: ['e'] }], gaps: [], recommendation: null, taskPromises: [],
    evidence: [{ id: 'e', kind: 'opportunity' as const, label: '商机', value: '旧证据',
      occurredAt: null, source: null }],
  };
  expect(buildTodayActions({ referenceDate: '2026-10-16', tasks: [], followups: [],
    opportunities: [opportunity] })).toEqual([]);
});

it('orders urgent tasks ahead of tomorrow tasks independent of source order', () => {
  const task = (guid: string, daysUntilDue: number) => ({ guid, title: guid, status: 'todo',
    completedAt: null, dueAt: '2026-10-16T00:00:00Z', dueDate: '2026-10-16', daysUntilDue,
    url: null, category: 'due_today' as const, priority: 'high' as const, suggestedAction: '核实' });
  const items = buildTodayActions({ referenceDate: '2026-10-16', opportunities: [], followups: [],
    tasks: [task('tomorrow', 1), task('overdue', -3)] });
  expect(items.map((item) => item.sourceId)).toEqual(['overdue', 'tomorrow']);
});

it('does not create reminders from records with missing deadline evidence', () => {
  expect(buildTodayActions({ referenceDate: '2026-10-16', opportunities: [], followups: [],
    tasks: [{ guid: 'missing', title: '未知截止', status: 'todo', completedAt: null,
      dueAt: null, dueDate: null, daysUntilDue: 0, url: null, category: 'due_today',
      priority: 'high', suggestedAction: '核实' }],
  })).toEqual([]);
});
