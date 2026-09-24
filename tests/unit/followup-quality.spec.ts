import { describe, expect, it } from 'vitest';

import {
  FollowupQualityService,
} from '@server/modules/sales-behavior/followup-quality.service';
import type {
  FollowupQualityInput,
} from '@server/modules/sales-behavior/sales-behavior.types';

const completeInput = (): FollowupQualityInput => ({
  sourceText: [
    '9月18日通过视频会议与北辰制造张总沟通数字化项目。',
    '客户需要在华东工厂先试点，预算已确认约50万元。',
    '张总认可方案，当前进入商务评估阶段。',
    '决策人是王总，采购负责人刘经理参与评审。',
    '客户担心上线周期，我们已承诺补充实施计划。',
    '下一步由销售李胜彬在9月20日前发送实施计划并约张总复盘。',
  ].join(''),
  generatedBody: '已与北辰制造完成方案沟通，客户认可试点方向并进入商务评估。下一步将发送实施计划并安排复盘。',
  draft: {
    customerName: '北辰制造',
    contactName: '张总',
    opportunityName: '数字化项目',
    summary: '客户认可试点方向，进入商务评估。',
    customerNeeds: ['华东工厂先试点'],
    objections: ['担心上线周期'],
    risks: [],
    progress: '进入商务评估阶段',
    expectedAmount: 500000,
    nextAction: '发送实施计划并约张总复盘',
    dueAt: '2026-09-20T18:00:00+08:00',
    evidenceQuotes: ['客户需要在华东工厂先试点', '下一步由销售李胜彬'],
  },
  communicationMethod: '视频会议',
  communicationAt: '2026-09-18T15:00:00+08:00',
  topic: '数字化项目方案沟通',
  agreements: ['张总认可方案'],
  decisionChain: ['王总（决策人）', '刘经理（采购）'],
  competitors: [],
  nextActionOwner: '李胜彬',
  nextActionParticipants: ['张总'],
  evidence: [
    { field: 'customerName', assertionKind: 'fact', quote: '北辰制造' },
    { field: 'customerNeeds', assertionKind: 'fact', quote: '客户需要在华东工厂先试点' },
    { field: 'expectedAmount', assertionKind: 'fact', quote: '预算已确认约50万元' },
    { field: 'progress', assertionKind: 'fact', quote: '进入商务评估阶段' },
    { field: 'decisionChain', assertionKind: 'fact', quote: '决策人是王总' },
    { field: 'nextAction', assertionKind: 'fact', quote: '下一步由销售李胜彬在9月20日前发送实施计划' },
  ],
});

describe('FollowupQualityService v1', (): void => {
  const service = new FollowupQualityService();

  it('awards 100 to a complete, evidenced and actionable followup', (): void => {
    const result = service.review(completeInput(), new Date('2026-09-19T10:00:00+08:00'));
    expect(result).toMatchObject({
      score: 100,
      grade: 'A',
      confirmable: true,
      scoreVersion: 'followup-quality-v1',
      risks: [],
    });
    expect(result.dimensions).toEqual({
      basics: 25,
      dealFacts: 20,
      nextStep: 25,
      evidence: 20,
      writing: 10,
    });
  });

  it('caps the score at 59 when customer or next action is absent', (): void => {
    const input = completeInput();
    input.draft.customerName = null;
    input.draft.nextAction = null;
    input.evidence = input.evidence.filter((item): boolean =>
      item.field !== 'customerName' && item.field !== 'nextAction',
    );
    const result = service.review(input, new Date('2026-09-19T10:00:00+08:00'));
    expect(result.score).toBe(59);
    expect(result.grade).toBe('D');
    expect(result.missingItems).toEqual(expect.arrayContaining([
      'customerName',
      'nextAction',
    ]));
    expect(result.risks).toContain('missing_next_step');
  });

  it('blocks confirmation when a fact quote is absent from the source', (): void => {
    const input = completeInput();
    input.evidence.push({
      field: 'customerCommitment',
      assertionKind: 'fact',
      quote: '客户已经签署合同',
    });
    const result = service.review(input, new Date('2026-09-19T10:00:00+08:00'));
    expect(result.confirmable).toBe(false);
    expect(result.invalidEvidence).toEqual([
      { field: 'customerCommitment', quote: '客户已经签署合同' },
    ]);
    expect(result.risks).toContain('customer_commitment_unverified');
  });

  it('keeps missing fields structured instead of leaking internal names into suggestions', (): void => {
    const input = completeInput();
    input.communicationMethod = null;
    input.communicationAt = null;

    const result = service.review(
      input,
      new Date('2026-09-19T10:00:00+08:00'),
    );

    expect(result.missingItems).toEqual(expect.arrayContaining([
      'communicationMethod',
      'communicationAt',
    ]));
    expect(result.suggestions.join(' ')).not.toContain(
      'communicationMethod',
    );
    expect(result.suggestions.join(' ')).not.toContain('communicationAt');
  });

  it('adds evidenced competitor, support and overdue risks without inventing them', (): void => {
    const input = completeInput();
    input.sourceText += '客户也在对比竞品甲，并请售前协助技术答疑。';
    input.competitors = ['竞品甲'];
    input.draft.risks = ['需要售前支持'];
    input.draft.dueAt = '2026-09-18T18:00:00+08:00';
    input.evidence.push(
      { field: 'competitors', assertionKind: 'fact', quote: '对比竞品甲' },
      { field: 'supportRequested', assertionKind: 'fact', quote: '请售前协助技术答疑' },
    );
    const result = service.review(input, new Date('2026-09-19T10:00:00+08:00'));
    expect(result.risks).toEqual(expect.arrayContaining([
      'competitor_mentioned',
      'support_requested',
      'overdue_action',
    ]));

    const noEvidence = completeInput();
    noEvidence.competitors = ['臆测竞品'];
    expect(service.review(noEvidence).risks).not.toContain('competitor_mentioned');
  });
});
