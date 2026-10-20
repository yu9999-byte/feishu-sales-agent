import { Inject, Injectable } from '@nestjs/common';
import type { PlaybookDraftReviewResponse, PlaybookDraftReviewEvent } from '@shared/api.interface';
import {
  PLAYBOOK_DRAFT_REVIEW_REPOSITORY,
  type PlaybookDraftReviewInput,
  type PlaybookDraftReviewRepository,
} from './playbook-authoring.ports';

class PlaybookDraftReviewError extends Error {
  constructor(
    readonly code: 'VALIDATION_FAILED' | 'NOT_FOUND' | 'CONFLICT' | 'UNAVAILABLE',
    message: string,
  ) { super(message); }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const invalid = (): never => {
  throw new PlaybookDraftReviewError('VALIDATION_FAILED', '审核参数无效，请检查版本和说明');
};
const identity = (...values: string[]): void => {
  if (values.some((value: string): boolean => typeof value !== 'string' || !UUID.test(value))) invalid();
};
const cursor = (raw: string | undefined): number | undefined => {
  if (raw === undefined) return undefined;
  if (!/^[1-9][0-9]*$/u.test(raw)) invalid();
  const value: number = Number(raw);
  if (!Number.isSafeInteger(value) || value > 2147483647) invalid();
  return value;
};
const note = (raw: unknown): string => {
  if (typeof raw !== 'string') return invalid();
  const value: string = raw.trim();
  if (value.length < 2 || value.length > 500 || value.includes('\0')) invalid();
  return value;
};

@Injectable()
class PlaybookDraftReviewService {
  constructor(
    @Inject(PLAYBOOK_DRAFT_REVIEW_REPOSITORY)
    private readonly repository: PlaybookDraftReviewRepository,
  ) {}

  async list(tenantId: string, candidateId: string, rawBefore?: string): Promise<PlaybookDraftReviewResponse> {
    identity(tenantId, candidateId);
    const beforeSequence: number | undefined = cursor(rawBefore);
    try {
      const response = await this.repository.list({ tenantId, candidateId, beforeSequence, limit: 20 });
      if (response === null) throw new PlaybookDraftReviewError('NOT_FOUND', '候选不存在');
      return response;
    } catch (error: unknown) { this.rethrow(error, '审核记录暂时无法读取'); }
  }

  async record(input: PlaybookDraftReviewInput): Promise<PlaybookDraftReviewEvent> {
    identity(input.tenantId, input.candidateId, input.actorMemberId, input.requestId);
    if (!Number.isInteger(input.expectedVersion) || input.expectedVersion < 1 || input.expectedVersion > 2147483647 ||
      !Number.isInteger(input.expectedReviewSequence) || input.expectedReviewSequence < 0 ||
      input.expectedReviewSequence >= 2147483647 ||
      !['submit', 'approve', 'request_changes'].includes(input.action)) invalid();
    const normalized: PlaybookDraftReviewInput = {
      ...input, requestId: input.requestId.toLowerCase(), note: note(input.note),
    };
    try {
      const result = await this.repository.record(normalized);
      if (result.status === 'recorded' && result.event) return result.event;
      if (result.status === 'not_found') throw new PlaybookDraftReviewError('NOT_FOUND', '候选不存在');
      const message: string = result.status === 'not_accepted' ? '仅待编写候选可以提交审核' :
        result.status === 'request_mismatch' ? '请求编号已用于其他审核，请刷新状态' :
          result.status === 'invalid_transition' ? '当前版本状态不允许此审核动作' :
            '草稿或审核状态已变化，请刷新后重试';
      throw new PlaybookDraftReviewError('CONFLICT', message);
    } catch (error: unknown) { this.rethrow(error, '审核记录暂时无法保存，请使用原请求重试'); }
  }

  private rethrow(error: unknown, message: string): never {
    if (error instanceof PlaybookDraftReviewError) throw error;
    throw new PlaybookDraftReviewError('UNAVAILABLE', message);
  }
}

export { PlaybookDraftReviewError, PlaybookDraftReviewService };
