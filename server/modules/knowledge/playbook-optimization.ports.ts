import type {
  PlaybookOptimizationCandidate,
  PlaybookOptimizationReason,
  PlaybookOptimizationReviewDecision,
  PlaybookOptimizationSourceRef,
  SalesKnowledgeQaResponse,
} from '@shared/api.interface';
import type { TenantIntegration } from
  '@server/modules/agent-core/agent.types';

interface PlaybookOptimizationObservationInput {
  integration: TenantIntegration;
  question: string;
  result: SalesKnowledgeQaResponse;
  observedAt?: Date;
}

interface PlaybookOptimizationObserver {
  observe(input: PlaybookOptimizationObservationInput):
    Promise<PlaybookOptimizationCandidate | null>;
}

interface PlaybookOptimizationRecordInput {
  tenantId: string;
  questionFingerprint: string;
  topicPreview: string;
  qaStatus: SalesKnowledgeQaResponse['status'];
  reasons: PlaybookOptimizationReason[];
  sources: PlaybookOptimizationSourceRef[];
  observedAt: Date;
}

interface PlaybookOptimizationListInput {
  tenantId: string;
  limit: number;
}

interface PlaybookOptimizationReviewInput {
  tenantId: string;
  candidateId: string;
  reviewerMemberId: string;
  decision: PlaybookOptimizationReviewDecision;
  expectedUpdatedAt: Date;
  note: string;
  reviewedAt: Date;
}

type PlaybookOptimizationReviewResult =
  | {
      status: 'reviewed';
      candidate: PlaybookOptimizationCandidate;
      reviewId: string;
    }
  | { status: 'not_found' }
  | { status: 'conflict'; currentUpdatedAt?: Date };

interface PlaybookOptimizationRepository {
  observe(input: PlaybookOptimizationRecordInput):
    Promise<PlaybookOptimizationCandidate>;
  list(input: PlaybookOptimizationListInput):
    Promise<PlaybookOptimizationCandidate[]>;
  review(input: PlaybookOptimizationReviewInput):
    Promise<PlaybookOptimizationReviewResult>;
}

const PLAYBOOK_OPTIMIZATION_OBSERVER = Symbol(
  'PLAYBOOK_OPTIMIZATION_OBSERVER',
);
const PLAYBOOK_OPTIMIZATION_REPOSITORY = Symbol(
  'PLAYBOOK_OPTIMIZATION_REPOSITORY',
);

export {
  PLAYBOOK_OPTIMIZATION_OBSERVER,
  PLAYBOOK_OPTIMIZATION_REPOSITORY,
};
export type {
  PlaybookOptimizationListInput,
  PlaybookOptimizationObservationInput,
  PlaybookOptimizationObserver,
  PlaybookOptimizationRecordInput,
  PlaybookOptimizationRepository,
  PlaybookOptimizationReviewInput,
  PlaybookOptimizationReviewResult,
};
