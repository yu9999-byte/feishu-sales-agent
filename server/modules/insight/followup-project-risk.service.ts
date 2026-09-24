import { Injectable } from '@nestjs/common';

import type { PendingAction } from '@server/modules/agent-core/agent.types';

type FollowupProjectRiskType =
  | 'negative_sentiment'
  | 'competitor_mentioned'
  | 'support_requested'
  | 'overdue_action';

type FollowupProjectRiskSeverity = 'high' | 'medium';

interface FollowupProjectRisk {
  type: FollowupProjectRiskType;
  severity: FollowupProjectRiskSeverity;
  label: string;
  evidence: string;
  suggestion: string;
}

interface FollowupProjectRiskInsight {
  healthScore: null;
  sampleStatus: 'insufficient';
  analyzedAt: string;
  risks: FollowupProjectRisk[];
}

interface RiskRule {
  type: FollowupProjectRiskType;
  severity: FollowupProjectRiskSeverity;
  label: string;
  suggestion: string;
  matches: (sentence: string) => boolean;
}

const NEGATIVE_SIGNAL_PATTERN: RegExp =
  /(?:不满|拒绝|暂停推进|停止推进|搁置|终止|不再考虑|负面)/u;
const COMPETITOR_PATTERN: RegExp = /(?:竞品|竞争对手|友商)/u;
const SUPPORT_ROLE_PATTERN: RegExp = /(?:售前|产品)/u;
const SUPPORT_ACTION_PATTERN: RegExp = /(?:支持|参与|答疑|介入|协助)/u;
const OVERDUE_PATTERN: RegExp = /(?:已逾期|到期未|仍未完成|尚未完成|未按时)/u;

const RISK_RULES: RiskRule[] = [
  {
    type: 'negative_sentiment',
    severity: 'high',
    label: '客户负向或停止推进',
    suggestion: '尽快确认客户异议、暂停原因和恢复推进所需条件。',
    matches: (sentence: string): boolean =>
      NEGATIVE_SIGNAL_PATTERN.test(sentence),
  },
  {
    type: 'competitor_mentioned',
    severity: 'high',
    label: '竞品介入',
    suggestion: '补充竞品、客户比较维度与我方差异化应对动作。',
    matches: (sentence: string): boolean =>
      COMPETITOR_PATTERN.test(sentence),
  },
  {
    type: 'support_requested',
    severity: 'medium',
    label: '需要售前或产品支持',
    suggestion: '明确支持人、交付内容和完成时间，再协调对应资源。',
    matches: (sentence: string): boolean =>
      SUPPORT_ROLE_PATTERN.test(sentence) &&
      SUPPORT_ACTION_PATTERN.test(sentence),
  },
];

@Injectable()
class FollowupProjectRiskService {
  analyze(
    action: PendingAction,
    now: Date,
  ): FollowupProjectRiskInsight | null {
    const rawText: string = action.payload.rawText.trim();
    if (rawText.length === 0) return null;

    const sentences: string[] = this.sentences(rawText);
    const risks: FollowupProjectRisk[] = RISK_RULES.flatMap(
      (rule: RiskRule): FollowupProjectRisk[] => {
        const evidence: string | undefined = sentences.find(
          (sentence: string): boolean => rule.matches(sentence),
        );
        return evidence
          ? [{
              type: rule.type,
              severity: rule.severity,
              label: rule.label,
              evidence,
              suggestion: rule.suggestion,
            }]
          : [];
      },
    );
    const overdueRisk: FollowupProjectRisk | null = this.findOverdueRisk(
      action,
      now,
      sentences,
    );
    if (overdueRisk !== null) risks.push(overdueRisk);
    if (risks.length === 0) return null;

    return {
      healthScore: null,
      sampleStatus: 'insufficient',
      analyzedAt: now.toISOString(),
      risks,
    };
  }

  private findOverdueRisk(
    action: PendingAction,
    now: Date,
    sentences: string[],
  ): FollowupProjectRisk | null {
    const dueAtValue: string | null = action.payload.draft.dueAt;
    if (dueAtValue === null) return null;
    const dueAt: Date = new Date(dueAtValue);
    if (Number.isNaN(dueAt.getTime()) || dueAt.getTime() >= now.getTime()) {
      return null;
    }
    const evidence: string | undefined = sentences.find(
      (sentence: string): boolean => OVERDUE_PATTERN.test(sentence),
    );
    if (evidence === undefined) return null;
    return {
      type: 'overdue_action',
      severity: 'medium',
      label: '行动已逾期',
      evidence,
      suggestion: '确认行动当前状态，并重新约定负责人和可执行时间。',
    };
  }

  private sentences(rawText: string): string[] {
    return rawText
      .match(/[^\n。！？!?]+[。！？!?]?/gu)
      ?.map((sentence: string): string => sentence.trim())
      .filter((sentence: string): boolean => sentence.length > 0) ?? [];
  }
}

export {
  FollowupProjectRiskService,
};
export type {
  FollowupProjectRisk,
  FollowupProjectRiskInsight,
  FollowupProjectRiskSeverity,
  FollowupProjectRiskType,
};
