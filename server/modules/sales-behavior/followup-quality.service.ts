import { Injectable } from '@nestjs/common';

import type {
  FollowupEvidenceInput,
  FollowupQualityDimensions,
  FollowupQualityInput,
  FollowupQualityResult,
  FollowupQualityRisk,
  InvalidFollowupEvidence,
} from './sales-behavior.types';

const hasText = (value: string | null | undefined): boolean =>
  typeof value === 'string' && value.trim().length > 0;

const validDate = (value: string | null): Date | null => {
  if (!hasText(value)) {
    return null;
  }
  const date = new Date(value as string);
  return Number.isNaN(date.getTime()) ? null : date;
};

const unique = <T>(values: T[]): T[] => Array.from(new Set(values));

const gradeFor = (score: number): FollowupQualityResult['grade'] => {
  if (score >= 85) return 'A';
  if (score >= 70) return 'B';
  if (score >= 60) return 'C';
  return 'D';
};

@Injectable()
class FollowupQualityService {
  review(
    input: FollowupQualityInput,
    now: Date = new Date(),
  ): FollowupQualityResult {
    const invalidEvidence: InvalidFollowupEvidence[] = input.evidence
      .filter((evidence: FollowupEvidenceInput): boolean =>
        evidence.assertionKind === 'fact' &&
        (!hasText(evidence.quote) || !input.sourceText.includes(evidence.quote)),
      )
      .map((evidence: FollowupEvidenceInput): InvalidFollowupEvidence => ({
        field: evidence.field,
        quote: evidence.quote,
      }));
    const validEvidence: FollowupEvidenceInput[] = input.evidence.filter(
      (evidence: FollowupEvidenceInput): boolean =>
        evidence.assertionKind === 'suggestion' ||
        (hasText(evidence.quote) && input.sourceText.includes(evidence.quote)),
    );
    const validFactFields = new Set<string>(
      validEvidence
        .filter((evidence): boolean => evidence.assertionKind === 'fact')
        .map((evidence): string => evidence.field),
    );

    const dimensions: FollowupQualityDimensions = {
      basics:
        (hasText(input.draft.customerName) ? 8 : 0) +
        (hasText(input.draft.contactName) ? 5 : 0) +
        (hasText(input.communicationMethod) && validDate(input.communicationAt) ? 4 : 0) +
        (hasText(input.topic) ? 3 : 0) +
        (input.generatedBody.trim().length >= 20 ? 5 : 0),
      dealFacts:
        (input.draft.customerNeeds.length > 0 ? 6 : 0) +
        (input.draft.objections.length > 0 || input.agreements.length > 0 ? 4 : 0) +
        (input.draft.expectedAmount !== null ? 4 : 0) +
        (hasText(input.draft.progress) ? 3 : 0) +
        (input.decisionChain.length > 0 ? 3 : 0),
      nextStep:
        (hasText(input.draft.nextAction) ? 8 : 0) +
        (validDate(input.draft.dueAt) ? 7 : 0) +
        (hasText(input.nextActionOwner) ? 5 : 0) +
        (input.nextActionParticipants.length > 0 ? 5 : 0),
      evidence:
        (validFactFields.size >= 5 ? 12 : Math.min(validFactFields.size * 2, 10)) +
        (input.evidence.length > 0 && input.evidence.every(
          (evidence): boolean => evidence.assertionKind === 'fact' || evidence.assertionKind === 'suggestion',
        ) ? 4 : 0) +
        (invalidEvidence.length === 0 ? 4 : 0),
      writing:
        (input.generatedBody.trim().length >= 20 && input.generatedBody.length <= 500 ? 4 : 0) +
        (/下一步/u.test(input.generatedBody) ? 3 : 0) +
        (!/(百分百|保证成交|绝对没问题)/u.test(input.generatedBody) ? 3 : 0),
    };

    const missingItems: string[] = [];
    if (!hasText(input.draft.customerName)) missingItems.push('customerName');
    if (!hasText(input.draft.contactName)) missingItems.push('contactName');
    if (!hasText(input.communicationMethod)) missingItems.push('communicationMethod');
    if (validDate(input.communicationAt) === null) missingItems.push('communicationAt');
    if (!hasText(input.topic)) missingItems.push('topic');
    if (!hasText(input.draft.nextAction)) missingItems.push('nextAction');
    if (validDate(input.draft.dueAt) === null) missingItems.push('dueAt');
    if (!hasText(input.nextActionOwner)) missingItems.push('nextActionOwner');
    if (input.nextActionParticipants.length === 0) missingItems.push('nextActionParticipants');

    const risks: FollowupQualityRisk[] = [];
    if (!hasText(input.draft.nextAction)) risks.push('missing_next_step');
    if (validDate(input.draft.dueAt) === null) risks.push('missing_due_at');
    if (input.draft.expectedAmount === null) risks.push('budget_unknown');
    if (input.decisionChain.length === 0) risks.push('decision_chain_unknown');
    if (input.competitors.length > 0 && validFactFields.has('competitors')) {
      risks.push('competitor_mentioned');
    }
    if (invalidEvidence.some((evidence): boolean =>
      evidence.field === 'customerCommitment')) {
      risks.push('customer_commitment_unverified');
    }
    const dueAt: Date | null = validDate(input.draft.dueAt);
    if (dueAt !== null && dueAt.getTime() < now.getTime()) {
      risks.push('overdue_action');
    }
    if (validFactFields.has('supportRequested')) {
      risks.push('support_requested');
    }

    const rawScore: number = Object.values(dimensions).reduce(
      (sum: number, value: number): number => sum + value,
      0,
    );
    const capped: boolean =
      !hasText(input.draft.customerName) || !hasText(input.draft.nextAction);
    const score: number = capped ? Math.min(rawScore, 59) : rawScore;
    const suggestions: string[] = [];
    if (invalidEvidence.length > 0) {
      suggestions.push('删除无来源证据的事实，或改为明确的建议');
    }

    return {
      score,
      grade: gradeFor(score),
      confirmable: invalidEvidence.length === 0,
      scoreVersion: 'followup-quality-v1',
      dimensions,
      missingItems,
      invalidEvidence,
      risks: unique(risks),
      suggestions,
    };
  }
}

export { FollowupQualityService };
