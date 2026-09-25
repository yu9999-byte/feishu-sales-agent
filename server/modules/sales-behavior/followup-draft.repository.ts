import type {
  FollowupDraft,
  FollowupProgressSnapshot,
  FollowupTaskCandidate,
  SalesContext,
} from '@shared/api.interface';
import type {
  FollowupQualityResult,
} from './sales-behavior.types';

type FollowupSourceType =
  | 'card_form'
  | 'text'
  | 'voice'
  | 'minutes'
  | 'document';

type FollowupDraftStatus =
  | 'pendingConfirmation'
  | 'confirmed'
  | 'cancelled';

type FollowupDraftCreationKind =
  | 'generated'
  | 'user_edit'
  | 'regenerated'
  | 'confirmed';

interface FollowupDraftVersionRecord {
  tenantId: string;
  draftId: string;
  version: number;
  creationKind: FollowupDraftCreationKind;
  sourceText: string;
  generatedBody: string;
  draft: FollowupDraft;
  quality: FollowupQualityResult;
  salesContext?: SalesContext;
  progressAssessment?: FollowupProgressSnapshot;
  taskCandidates?: FollowupTaskCandidate[];
  createdAt: Date;
}

interface FollowupDraftRecord {
  id: string;
  tenantId: string;
  ownerMemberId: string;
  sourceType: FollowupSourceType;
  status: FollowupDraftStatus;
  currentVersion: number;
  version: FollowupDraftVersionRecord;
}

interface CreateDraftRecordInput {
  tenantId: string;
  ownerMemberId: string;
  sourceType: FollowupSourceType;
  idempotencyKey: string;
  sourceText: string;
  generatedBody: string;
  draft: FollowupDraft;
  quality: FollowupQualityResult;
  salesContext?: SalesContext;
  progressAssessment?: FollowupProgressSnapshot;
  taskCandidates?: FollowupTaskCandidate[];
  createdAt: Date;
}

interface AppendDraftEditInput {
  tenantId: string;
  draftId: string;
  ownerMemberId: string;
  expectedVersion: number;
  generatedBody: string;
  draft: FollowupDraft;
  quality: FollowupQualityResult;
  salesContext?: SalesContext;
  progressAssessment?: FollowupProgressSnapshot;
  createdAt: Date;
}

interface FollowupDraftRepository {
  createGeneratedDraft(
    input: CreateDraftRecordInput,
  ): Promise<FollowupDraftRecord>;
  getDraft(
    tenantId: string,
    draftId: string,
  ): Promise<FollowupDraftRecord | null>;
  appendUserEdit(
    input: AppendDraftEditInput,
  ): Promise<FollowupDraftRecord | null>;
  markConfirmed(input: {
    tenantId: string;
    draftId: string;
    ownerMemberId: string;
    expectedVersion: number;
    confirmedAt: Date;
  }): Promise<FollowupDraftRecord | null>;
}

const FOLLOWUP_DRAFT_REPOSITORY = Symbol('FOLLOWUP_DRAFT_REPOSITORY');

export { FOLLOWUP_DRAFT_REPOSITORY };
export type {
  AppendDraftEditInput,
  CreateDraftRecordInput,
  FollowupDraftCreationKind,
  FollowupDraftRecord,
  FollowupDraftRepository,
  FollowupDraftStatus,
  FollowupDraftVersionRecord,
  FollowupSourceType,
};
