import { Inject, Injectable } from '@nestjs/common';
import type {
  PlaybookPublicationEvent, PlaybookPublicationResponse, PublishedPlaybook, PublishedPlaybookListResponse,
} from '@shared/api.interface';
import { PLAYBOOK_PUBLICATION_REPOSITORY, type PlaybookPublicationInput,
  type PlaybookPublicationRepository } from './playbook-publication.ports';

class PlaybookPublicationError extends Error {
  constructor(readonly code: 'VALIDATION_FAILED' | 'NOT_FOUND' | 'CONFLICT' | 'UNAVAILABLE', message: string) {
    super(message);
  }
}
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const invalid = (): never => { throw new PlaybookPublicationError('VALIDATION_FAILED', '发布参数无效，请检查版本和说明'); };
const identity = (...values: string[]): void => {
  if (values.some((value: string): boolean => typeof value !== 'string' || !UUID.test(value))) invalid();
};
const integer = (value: number, minimum: number, maximum = 2147483647): boolean =>
  Number.isInteger(value) && value >= minimum && value <= maximum;

@Injectable()
class PlaybookPublicationService {
  constructor(@Inject(PLAYBOOK_PUBLICATION_REPOSITORY) private readonly repository: PlaybookPublicationRepository) {}

  async list(tenantId: string, candidateId: string, rawBefore?: string): Promise<PlaybookPublicationResponse> {
    identity(tenantId, candidateId);
    if (rawBefore !== undefined && (!/^[1-9][0-9]*$/u.test(rawBefore) || !integer(Number(rawBefore), 1))) invalid();
    return this.guard(async () => {
      const result = await this.repository.list({ tenantId, candidateId,
        beforeSequence: rawBefore === undefined ? undefined : Number(rawBefore), limit: 20 });
      if (!result) throw new PlaybookPublicationError('NOT_FOUND', '候选不存在');
      return result;
    });
  }

  async record(input: PlaybookPublicationInput): Promise<PlaybookPublicationEvent> {
    identity(input.tenantId, input.candidateId, input.actorMemberId, input.requestId);
    if (!integer(input.expectedVersion, 1) || !integer(input.expectedPublicationSequence, 0, 2147483646) ||
      (input.action !== 'publish' && input.action !== 'withdraw') ||
      (input.action === 'publish' ? !integer(input.expectedReviewSequence, 1) : input.expectedReviewSequence !== null) ||
      typeof input.note !== 'string') invalid();
    const note: string = input.note.trim();
    if (note.length < 2 || note.length > 500 || note.includes('\0')) invalid();
    return this.guard(async () => {
      const result = await this.repository.record({ ...input, requestId: input.requestId.toLowerCase(), note });
      if (result.status === 'recorded') return result.event;
      if (result.status === 'not_found') throw new PlaybookPublicationError('NOT_FOUND', '候选不存在');
      const message: string = result.status === 'request_mismatch' ? '请求编号已用于其他发布操作，请刷新状态' :
        result.status === 'not_accepted' ? '仅待编写候选可以发布' :
          result.status === 'invalid_transition' ? '当前版本尚未批准、已经发布或已撤回，请刷新状态' :
            '草稿、审核或发布状态已变化，请刷新后重试';
      throw new PlaybookPublicationError('CONFLICT', message);
    });
  }

  async getPublished(tenantId: string, candidateId: string): Promise<PublishedPlaybook> {
    identity(tenantId, candidateId);
    return this.guard(async () => {
      const result = await this.repository.getPublished(tenantId, candidateId);
      if (!result) throw new PlaybookPublicationError('NOT_FOUND', '当前无可用的已发布资料');
      return result;
    });
  }

  async listPublished(tenantId: string, afterCandidateId?: string): Promise<PublishedPlaybookListResponse> {
    identity(tenantId, ...(afterCandidateId === undefined ? [] : [afterCandidateId]));
    return this.guard(() => this.repository.listPublished({ tenantId, afterCandidateId, limit: 20 }));
  }

  private async guard<T>(operation: () => Promise<T>): Promise<T> {
    try { return await operation(); }
    catch (error: unknown) {
      if (error instanceof PlaybookPublicationError) throw error;
      throw new PlaybookPublicationError('UNAVAILABLE', '发布状态暂时不可用；保存结果未知时请重试原请求');
    }
  }
}
export { PlaybookPublicationError, PlaybookPublicationService };
