import { describe, expect, it } from 'vitest';

import type { PendingAction } from '@server/modules/agent-core/agent.types';
import { createProjectRiskCard } from '@server/modules/agent-core/agent.cards';
import { FollowupProjectRiskService } from '@server/modules/insight/followup-project-risk.service';

const createAction = (rawText: string): PendingAction => ({
  id: '00000000-0000-4000-8000-000000000001',
  tenantId: '00000000-0000-4000-8000-000000000002',
  actorOpenId: 'ou_sales',
  chatId: 'oc_sales',
  cardMessageId: 'om_draft',
  status: 'succeeded',
  payload: {
    version: 1,
    interactionStage: 'draft',
    sourceMessageId: 'om_source',
    rawText,
    draft: {
      customerName: '北辰制造',
      contactName: '张总',
      opportunityName: '试点项目',
      summary: '已沟通试点方案',
      customerNeeds: [],
      objections: [],
      risks: [],
      progress: '方案沟通',
      expectedAmount: null,
      nextAction: '安排技术交流',
      dueAt: '2026-09-22T14:00:00+08:00',
      evidenceQuotes: [],
      nextActionChannel: '客户现场',
      nextActionParticipants: ['张总', '售前王工'],
    },
    draftVersion: 1,
    quality: {
      score: 75,
      grade: 'B',
      confirmable: true,
      scoreVersion: 'followup-quality-v1',
      dimensions: {
        basics: 20,
        dealFacts: 10,
        nextStep: 25,
        evidence: 10,
        writing: 10,
      },
      missingItems: ['budget', 'decisionChain'],
      invalidEvidence: [],
      risks: ['budget_unknown', 'decision_chain_unknown'],
      suggestions: ['建议补充预算和决策链'],
    },
    selectedTaskCandidateIds: [],
  },
  result: {
    pendingActionId: '00000000-0000-4000-8000-000000000001',
    status: 'succeeded',
  },
  expiresAt: new Date('2026-09-23T00:00:00+08:00'),
  createdAt: new Date('2026-09-20T10:00:00+08:00'),
  updatedAt: new Date('2026-09-20T10:05:00+08:00'),
});

describe('FollowupProjectRiskService', (): void => {
  const service = new FollowupProjectRiskService();

  it('does not send a project card for unknown budget or decision chain alone', (): void => {
    const action: PendingAction = createAction(
      '客户认可试点方案。客户预算和决策链尚未确认。',
    );

    expect(service.analyze(action, new Date('2026-09-20T12:00:00+08:00')))
      .toBeNull();
  });

  it('returns evidenced actionable risks and no invented health score', (): void => {
    const action: PendingAction = createAction([
      '客户明确表示对当前方案不满，项目暂停推进。',
      '张总正在对比竞品甲。',
      '客户希望售前王工参与技术答疑并提供支持。',
    ].join(''));

    const insight = service.analyze(
      action,
      new Date('2026-09-20T12:00:00+08:00'),
    );

    expect(insight).not.toBeNull();
    expect(insight?.healthScore).toBeNull();
    expect(insight?.sampleStatus).toBe('insufficient');
    expect(insight?.risks.map((risk): string => risk.type)).toEqual([
      'negative_sentiment',
      'competitor_mentioned',
      'support_requested',
    ]);
    expect(insight?.risks.every((risk): boolean =>
      action.payload.rawText.includes(risk.evidence),
    )).toBe(true);
  });

  it('renders the evidence, advice, and insufficient-sample boundary', (): void => {
    const action: PendingAction = createAction(
      '客户明确表示项目暂停推进。张总正在对比竞品甲。',
    );
    const insight = service.analyze(
      action,
      new Date('2026-09-20T12:00:00+08:00'),
    );
    if (insight === null) throw new Error('Expected project risk insight');

    const serialized: string = JSON.stringify(
      createProjectRiskCard(action, insight),
    );

    expect(serialized).toContain('项目推进风险提醒');
    expect(serialized).toContain('样本不足，暂不生成项目健康度评分');
    expect(serialized).toContain('客户明确表示项目暂停推进');
    expect(serialized).toContain('尽快确认客户异议');
  });
});
