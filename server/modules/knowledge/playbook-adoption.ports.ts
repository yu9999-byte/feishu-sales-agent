import type {
  PlaybookAdoptionResponse, PlaybookAdoptionEvent, RecordPlaybookAdoptionRequest,
} from '@shared/api.interface';

type PlaybookAdoptionInput = RecordPlaybookAdoptionRequest & {
  tenantId: string;
  candidateId: string;
  actorMemberId: string;
  actorOpenId: string;
};
type PlaybookAdoptionResult =
  | { status: 'recorded'; event: PlaybookAdoptionEvent }
  | { status: 'not_found' | 'no_publication' | 'conflict' | 'request_mismatch' |
      'invalid_transition' | 'invalid_evidence' };
interface PlaybookAdoptionRepository {
  list(input: { tenantId: string; candidateId: string; beforeSequence?: number; limit: number }):
    Promise<PlaybookAdoptionResponse | null>;
  record(input: PlaybookAdoptionInput): Promise<PlaybookAdoptionResult>;
}
const PLAYBOOK_ADOPTION_REPOSITORY = Symbol('PLAYBOOK_ADOPTION_REPOSITORY');
export { PLAYBOOK_ADOPTION_REPOSITORY };
export type { PlaybookAdoptionInput, PlaybookAdoptionRepository, PlaybookAdoptionResult };
