import type { FollowupDraft } from '@shared/api.interface';

type FollowupAssertionKind = 'fact' | 'suggestion';

interface FollowupEvidenceInput {
  field: string;
  assertionKind: FollowupAssertionKind;
  quote: string;
}

interface FollowupQualityInput {
  sourceText: string;
  generatedBody: string;
  draft: FollowupDraft;
  communicationMethod: string | null;
  communicationAt: string | null;
  topic: string | null;
  agreements: string[];
  decisionChain: string[];
  competitors: string[];
  nextActionOwner: string | null;
  nextActionParticipants: string[];
  evidence: FollowupEvidenceInput[];
}

type FollowupQualityRisk =
  | 'missing_next_step'
  | 'missing_due_at'
  | 'budget_unknown'
  | 'decision_chain_unknown'
  | 'competitor_mentioned'
  | 'negative_sentiment'
  | 'customer_commitment_unverified'
  | 'overdue_action'
  | 'support_requested';

interface FollowupQualityDimensions {
  basics: number;
  dealFacts: number;
  nextStep: number;
  evidence: number;
  writing: number;
}

interface InvalidFollowupEvidence {
  field: string;
  quote: string;
}

interface FollowupQualityResult {
  score: number;
  grade: 'A' | 'B' | 'C' | 'D';
  confirmable: boolean;
  scoreVersion: 'followup-quality-v1';
  dimensions: FollowupQualityDimensions;
  missingItems: string[];
  invalidEvidence: InvalidFollowupEvidence[];
  risks: FollowupQualityRisk[];
  suggestions: string[];
}

export type {
  FollowupAssertionKind,
  FollowupEvidenceInput,
  FollowupQualityDimensions,
  FollowupQualityInput,
  FollowupQualityResult,
  FollowupQualityRisk,
  InvalidFollowupEvidence,
};
