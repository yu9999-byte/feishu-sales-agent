import type { RecordTaskPromiseEvidenceRequest, TaskPromiseEvidenceEvent,
  TaskPromiseEvidenceResponse } from '@shared/api.interface';

interface TaskPromiseEvidenceOwner {
  tenantId: string;
  actionId: string;
  actorOpenId: string;
}
interface TaskPromiseEvidenceInput extends RecordTaskPromiseEvidenceRequest, TaskPromiseEvidenceOwner {
  actorMemberId: string;
}
type TaskPromiseEvidenceReadResult = { status: 'found'; response: TaskPromiseEvidenceResponse } |
  { status: 'not_found' | 'ineligible' };
type TaskPromiseEvidenceWriteResult = { status: 'recorded'; event: TaskPromiseEvidenceEvent } |
  { status: 'not_found' | 'ineligible' | 'conflict' | 'request_mismatch' };
interface TaskPromiseEvidenceRepository {
  list(input: TaskPromiseEvidenceOwner & { beforeRevision?: number; limit: number }): Promise<TaskPromiseEvidenceReadResult>;
  record(input: TaskPromiseEvidenceInput): Promise<TaskPromiseEvidenceWriteResult>;
}
const TASK_PROMISE_EVIDENCE_REPOSITORY = Symbol('TASK_PROMISE_EVIDENCE_REPOSITORY');
export { TASK_PROMISE_EVIDENCE_REPOSITORY };
export type { TaskPromiseEvidenceInput, TaskPromiseEvidenceOwner, TaskPromiseEvidenceRepository,
  TaskPromiseEvidenceReadResult, TaskPromiseEvidenceWriteResult };
