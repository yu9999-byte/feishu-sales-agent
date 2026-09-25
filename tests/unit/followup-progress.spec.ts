import { describe, expect, it } from 'vitest';

import type {
  FollowupDraft,
  FollowupProgressSnapshot,
  SalesContext,
} from '@shared/api.interface';
import {
  FollowupProgressService,
} from '@server/modules/sales-behavior/followup-progress.service';

const NOW = new Date('2026-09-25T10:00:00+08:00');

const source = (
  recordId: string,
  sourceVersion = '2026-09-24T02:00:00.000Z',
) => ({
  recordId,
  recordUrl: `https://example.feishu.cn/${recordId}`,
  sourceVersion,
});

const context = (overrides: Partial<SalesContext> = {}): SalesContext => ({
  status: 'ready',
  customer: {
    name: '北辰制造',
    contactName: '张总',
    latestSummary: '等待预算审批',
    lastFollowupAt: '2026-09-20T02:00:00.000Z',
    source: source('customer-1'),
  },
  customerCandidates: [],
  opportunities: [{
    name: '数字化升级项目',
    progress: '方案评估中',
    expectedAmount: 500000,
    nextAction: '等待客户内部评审',
    dueAt: '2026-09-24T10:00:00+08:00',
    source: source('opportunity-1'),
  }],
  recentFollowups: [{
    summary: '客户开始内部评审',
    opportunityRecordId: 'opportunity-1',
    nextAction: '等待客户内部评审',
    dueAt: '2026-09-24T10:00:00+08:00',
    source: source('followup-1', '2026-09-23T02:00:00.000Z'),
  }],
  conflicts: [],
  tasks: [],
  warnings: [],
  readAt: '2026-09-25T02:00:00.000Z',
  ...overrides,
});

const draft = (overrides: Partial<FollowupDraft> = {}): FollowupDraft => ({
  customerName: '北辰制造',
  contactName: '张总',
  opportunityName: '数字化升级项目',
  summary: '客户确认启动预算审批。',
  customerNeeds: ['先完成华东工厂试点'],
  objections: [],
  risks: [],
  progress: '预算审批已启动',
  expectedAmount: 500000,
  nextAction: '周五向张总确认审批结果',
  dueAt: '2026-09-26T16:00:00+08:00',
  evidenceQuotes: ['客户确认启动预算审批', '周五向张总确认审批结果'],
  decisionChain: ['张总负责推进预算审批'],
  agreements: ['启动预算审批'],
  competitors: [],
  ...overrides,
});

const assess = (
  value: FollowupDraft,
  salesContext: SalesContext,
  sourceText = '客户确认启动预算审批，周五向张总确认审批结果。',
): FollowupProgressSnapshot => new FollowupProgressService().assess({
  draft: value,
  salesContext,
  sourceText,
  now: NOW,
});

describe('FollowupProgressService', (): void => {
  it('grounds a progress change in the current message and opportunity record', (): void => {
    const result: FollowupProgressSnapshot = assess(draft(), context());

    expect(result.state).toBe('advanced');
    const change = result.findings.find((item) =>
      item.code === 'progress_changed');
    expect(change).toMatchObject({ kind: 'change' });
    expect(change?.evidenceIds.length).toBeGreaterThanOrEqual(2);
    const evidenceIds = new Set(result.facts.map((fact) => fact.id));
    expect(change?.evidenceIds.every((id) => evidenceIds.has(id))).toBe(true);
    expect(result.recommendation).toMatchObject({
      action: '周五向张总确认审批结果',
      requiresConfirmation: true,
      editableFields: ['nextAction', 'dueAt'],
    });
  });

  it('does not report a new change when the recorded progress is unchanged', (): void => {
    const result: FollowupProgressSnapshot = assess(draft({
      progress: '方案评估中',
    }), context());

    expect(result.state).toBe('steady');
    expect(result.headline).toBe('暂未发现明确的商机状态变化');
    expect(result.findings.some((item) =>
      item.code === 'progress_changed')).toBe(false);
  });

  it('shows budget, decision-chain and next-step gaps without inventing values', (): void => {
    const result: FollowupProgressSnapshot = assess(draft({
      expectedAmount: null,
      decisionChain: [],
      nextAction: null,
      dueAt: null,
      evidenceQuotes: ['客户确认启动预算审批'],
    }), context(), '客户确认启动预算审批。');

    expect(result.state).toBe('needs_attention');
    expect(result.findings.map((item) => item.code)).toEqual(
      expect.arrayContaining([
        'budget_unknown',
        'decision_chain_unknown',
        'next_action_missing',
        'due_at_missing',
      ]),
    );
    expect(result.recommendation).toBeNull();
  });

  it('prioritizes evidenced message risks and overdue owned tasks', (): void => {
    const result: FollowupProgressSnapshot = assess(draft({
      risks: ['竞品已进入最终比选'],
      competitors: ['友商 A'],
      evidenceQuotes: ['竞品已进入最终比选', '周五向张总确认审批结果'],
    }), context({
      tasks: [{
        guid: 'task-1',
        title: '发送试点报价',
        status: 'todo',
        dueAt: '2026-09-24T16:00:00+08:00',
        url: 'https://example.feishu.cn/task-1',
      }],
    }), '竞品已进入最终比选，周五向张总确认审批结果。');

    expect(result.state).toBe('at_risk');
    expect(result.findings.map((item) => item.code)).toEqual(
      expect.arrayContaining(['message_risk', 'competitor_mentioned', 'task_overdue']),
    );
    expect(result.findings.filter((item) => item.kind === 'risk')
      .every((item) => item.evidenceIds.length > 0)).toBe(true);
  });

  it('withholds recommendations when customer matching needs clarification', (): void => {
    const candidates = [
      context().customer!,
      {
        ...context().customer!,
        name: '北辰制造华东分公司',
        source: source('customer-2'),
      },
    ];
    const result: FollowupProgressSnapshot = assess(draft(), context({
      status: 'needs_clarification',
      customer: null,
      customerCandidates: candidates,
      opportunities: [],
      recentFollowups: [],
      tasks: [],
      warnings: ['customer_match_ambiguous'],
    }));

    expect(result.state).toBe('insufficient');
    expect(result.recommendation).toBeNull();
    expect(result.findings.some((item) =>
      item.code === 'customer_match_ambiguous')).toBe(true);
  });

  it('withholds recommendations when no unique customer was resolved', (): void => {
    const result: FollowupProgressSnapshot = assess(draft(), context({
      status: 'partial',
      customer: null,
      customerCandidates: [],
      warnings: ['business_context_permission_denied'],
    }));

    expect(result.state).toBe('insufficient');
    expect(result.recommendation).toBeNull();
    expect(result.warnings).toContain('部分业务资料无权读取');
  });

  it('keeps both sources for a conflict and reports partial-source warnings', (): void => {
    const salesContext = context({
      status: 'partial',
      conflicts: [{
        field: 'nextAction',
        opportunityValue: '等待内部评审',
        followupValue: '发送实施计划',
        opportunitySource: source('opportunity-1'),
        followupSource: source('followup-1'),
        newerSource: 'followup',
      }],
      warnings: ['sales_context_source_conflict', 'task_source_unavailable'],
    });
    const result: FollowupProgressSnapshot = assess(draft(), salesContext);
    const conflict = result.findings.find((item) =>
      item.code === 'source_conflict');

    expect(result.state).toBe('at_risk');
    expect(conflict?.evidenceIds).toHaveLength(2);
    expect(result.warnings.join('')).toContain('部分');
    expect(result.recommendation?.action).toBe('周五向张总确认审批结果');
  });

  it('does not create a recommendation for an explicit no-action followup', (): void => {
    const result: FollowupProgressSnapshot = assess(draft({
      nextAction: '暂无下一步',
      dueAt: null,
      evidenceQuotes: ['暂无下一步'],
    }), context(), '客户明确表示暂无下一步。');

    expect(result.recommendation).toBeNull();
    expect(result.findings.some((item) =>
      item.code === 'next_action_missing')).toBe(true);
  });
});
