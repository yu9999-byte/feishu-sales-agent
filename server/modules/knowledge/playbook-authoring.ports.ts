import type {
  PlaybookDraftResponse, PlaybookDraftVersion, SavePlaybookDraftRequest,
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
export { PLAYBOOK_AUTHORING_REPOSITORY };
export type {
  PlaybookAuthoringRepository, PlaybookDraftIdentity, PlaybookDraftSaveInput, PlaybookDraftSaveResult,
};
