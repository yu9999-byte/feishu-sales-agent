import type {
  PlaybookPublicationEvent, PlaybookPublicationResponse, PublishedPlaybook,
  PublishedPlaybookListResponse, RecordPlaybookPublicationRequest,
} from '@shared/api.interface';

type PlaybookPublicationInput = RecordPlaybookPublicationRequest & {
  tenantId: string; candidateId: string; actorMemberId: string;
};
type PlaybookPublicationResult =
  | { status: 'recorded'; event: PlaybookPublicationEvent }
  | { status: 'not_found' | 'not_accepted' | 'conflict' | 'request_mismatch' | 'invalid_transition' };
interface PlaybookPublicationRepository {
  list(input: { tenantId: string; candidateId: string; beforeSequence?: number; limit: number }):
    Promise<PlaybookPublicationResponse | null>;
  record(input: PlaybookPublicationInput): Promise<PlaybookPublicationResult>;
  getPublished(tenantId: string, candidateId: string): Promise<PublishedPlaybook | null>;
  listPublished(input: { tenantId: string; afterCandidateId?: string; limit: number }):
    Promise<PublishedPlaybookListResponse>;
}
const PLAYBOOK_PUBLICATION_REPOSITORY = Symbol('PLAYBOOK_PUBLICATION_REPOSITORY');
export { PLAYBOOK_PUBLICATION_REPOSITORY };
export type { PlaybookPublicationInput, PlaybookPublicationRepository, PlaybookPublicationResult };
