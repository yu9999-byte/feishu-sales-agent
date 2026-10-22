import { Inject, Injectable } from '@nestjs/common';
import type { PlaybookAdoptionEvent, PlaybookAdoptionResponse } from '@shared/api.interface';
import { PLAYBOOK_ADOPTION_REPOSITORY, type PlaybookAdoptionInput,
  type PlaybookAdoptionRepository } from './playbook-adoption.ports';

class PlaybookAdoptionError extends Error {
  constructor(readonly code: 'VALIDATION_FAILED' | 'NOT_FOUND' | 'CONFLICT' | 'UNAVAILABLE', message: string) {
    super(message);
  }
}
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const invalid = (): never => { throw new PlaybookAdoptionError('VALIDATION_FAILED', '采用参数无效，请检查版本、证据和说明'); };
const identity = (...values: string[]): void => {
  if (values.some((value: string): boolean => typeof value !== 'string' || !UUID.test(value))) invalid();
};
const integer = (value: number, minimum: number, maximum = 2147483646): boolean =>
  Number.isInteger(value) && value >= minimum && value <= maximum;
const text = (value: unknown, minimum: number, maximum: number): value is string =>
  typeof value === 'string' && value.trim().length >= minimum && value.trim().length <= maximum && !value.includes('\0');

@Injectable()
class PlaybookAdoptionService {
  constructor(@Inject(PLAYBOOK_ADOPTION_REPOSITORY) private readonly repository: PlaybookAdoptionRepository) {}

  async list(tenantId: string, candidateId: string, rawBefore?: string): Promise<PlaybookAdoptionResponse> {
    identity(tenantId, candidateId);
    if (rawBefore !== undefined && (!/^[1-9][0-9]*$/u.test(rawBefore) || !integer(Number(rawBefore), 1))) invalid();
    return this.guard(async () => {
      const result = await this.repository.list({ tenantId, candidateId,
        beforeSequence: rawBefore === undefined ? undefined : Number(rawBefore), limit: 20 });
      if (!result) throw new PlaybookAdoptionError('NOT_FOUND', '候选不存在');
      return result;
    });
  }

  async record(input: PlaybookAdoptionInput): Promise<PlaybookAdoptionEvent> {
    identity(input.tenantId, input.candidateId, input.actorMemberId, input.requestId);
    if (typeof input.actorOpenId !== 'string' || input.actorOpenId.trim().length === 0 || input.actorOpenId.length > 255 ||
      !integer(input.expectedAdoptionSequence, 0) || !integer(input.publicationVersion, 1) ||
      !integer(input.publicationSequence, 1) || (input.action !== 'record' && input.action !== 'retract') ||
      typeof input.evidence !== 'object' && input.evidence !== null || !text(input.note, 2, 500)) invalid();
    const note: string = input.note.trim();
    if (input.action === 'record') {
      const evidence = input.evidence;
      if (!evidence || !['followup', 'opportunity', 'task'].includes(evidence.kind) ||
        !text(evidence.recordId, 1, 255) || !text(evidence.note, 2, 500)) invalid();
      identity(evidence.actionId);
    } else if (input.evidence !== null) invalid();
    return this.guard(async () => {
      const result = await this.repository.record({ ...input, requestId: input.requestId.toLowerCase(),
        note, evidence: input.evidence ? { ...input.evidence, recordId: input.evidence.recordId.trim(),
          note: input.evidence.note.trim(), actionId: input.evidence.actionId.toLowerCase() } : null });
      if (result.status === 'recorded') return result.event;
      if (result.status === 'not_found') throw new PlaybookAdoptionError('NOT_FOUND', '候选不存在');
      const message: string = result.status === 'no_publication' ? '当前没有可采用的已发布版本' :
        result.status === 'request_mismatch' ? '请求编号已用于其他采用操作，请刷新状态' :
          result.status === 'invalid_evidence' ? '业务证据未能通过真实写入校验' :
            result.status === 'invalid_transition' ? '当前发布版本已撤回或已更换，请刷新状态' : '采用状态已变化，请刷新后重试';
      throw new PlaybookAdoptionError('CONFLICT', message);
    });
  }

  private async guard<T>(operation: () => Promise<T>): Promise<T> {
    try { return await operation(); }
    catch (error: unknown) {
      if (error instanceof PlaybookAdoptionError) throw error;
      throw new PlaybookAdoptionError('UNAVAILABLE', '采用状态暂时不可用；保存结果未知时请重试原请求');
    }
  }
}
export { PlaybookAdoptionError, PlaybookAdoptionService };
