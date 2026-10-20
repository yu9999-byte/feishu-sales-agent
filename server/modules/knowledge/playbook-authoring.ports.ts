import type {
  PlaybookDraftResponse, PlaybookDraftReviewResponse, PlaybookDraftVersion,
  RecordPlaybookDraftReviewRequest, SavePlaybookDraftRequest,
} from '@shared/api.interface';

interface PlaybookDraftIdentity { tenantId: string; candidateId: string }

interface PlaybookDraftSaveInput extends PlaybookDraftIdentity, SavePlaybookDraftRequest {
  authorMemberId: string;
}

type PlaybookDraftSaveResult =
  | { status: 'saved'; version: PlaybookDraftVersion }
  | { status: 'not_found' | 'not_accepted' | 'conflict' | 'request_mismatch' };

interface PlaybookAuthoringRepository {
  list(input: PlaybookDraftIdentity & { beforeVersion?: number; limit: number }):
    Promise<PlaybookDraftResponse | null>;
  get(input: PlaybookDraftIdentity & { version: number }): Promise<PlaybookDraftVersion | null>;
  save(input: PlaybookDraftSaveInput): Promise<PlaybookDraftSaveResult>;
}

const PLAYBOOK_AUTHORING_REPOSITORY = Symbol('PLAYBOOK_AUTHORING_REPOSITORY');
const PLAYBOOK_DRAFT_REVIEW_REPOSITORY = Symbol('PLAYBOOK_DRAFT_REVIEW_REPOSITORY');
export { PLAYBOOK_DRAFT_REVIEW_REPOSITORY };
export { PLAYBOOK_AUTHORING_REPOSITORY };

interface PlaybookDraftReviewInput extends PlaybookDraftIdentity, RecordPlaybookDraftReviewRequest {
  actorMemberId: string;
}

type PlaybookDraftReviewResult =
  | { status: 'recorded'; event: PlaybookDraftReviewResponse['current'] }
  | { status: 'not_found' | 'not_accepted' | 'conflict' | 'request_mismatch' | 'invalid_transition' };

interface PlaybookDraftReviewRepository {
  list(input: PlaybookDraftIdentity & { beforeSequence?: number; limit: number }):
    Promise<PlaybookDraftReviewResponse | null>;
  record(input: PlaybookDraftReviewInput): Promise<PlaybookDraftReviewResult>;
}

export type {
  PlaybookAuthoringRepository, PlaybookDraftIdentity, PlaybookDraftReviewInput,
  PlaybookDraftReviewRepository, PlaybookDraftReviewResult, PlaybookDraftSaveInput,
  PlaybookDraftSaveResult,
};
