import { Inject, Injectable } from '@nestjs/common';
import type { TaskPromiseEvidenceEvent, TaskPromiseEvidenceResponse } from '@shared/api.interface';
import { TASK_PROMISE_EVIDENCE_REPOSITORY, type TaskPromiseEvidenceInput,
  type TaskPromiseEvidenceOwner, type TaskPromiseEvidenceRepository } from './task-promise-evidence.ports';

class TaskPromiseEvidenceError extends Error {
  constructor(readonly code: 'VALIDATION_FAILED' | 'NOT_FOUND' | 'CONFLICT' | 'UNAVAILABLE', message: string) {
    super(message);
  }
}
const invalid = (): never => { throw new TaskPromiseEvidenceError('VALIDATION_FAILED', '凭证参数无效，请检查说明和链接'); };
const uuid = (...values: string[]): void => {
  if (values.some((value: string): boolean => typeof value !== 'string' ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu.test(value))) invalid();
};
const validateOwner = (input: TaskPromiseEvidenceOwner): void => {
  uuid(input.tenantId, input.actionId);
  if (typeof input.actorOpenId !== 'string' || !input.actorOpenId.trim() || input.actorOpenId.length > 255) invalid();
};
const validEvidenceUrl = (raw: unknown): raw is string => {
  if (typeof raw !== 'string' || raw.length > 2048 || raw !== raw.trim()) return false;
  try {
    const url: URL = new URL(raw);
    return url.protocol === 'https:' && !url.username && !url.password && !url.port &&
      ['feishu.cn', 'larksuite.com'].some((host: string): boolean =>
        url.hostname === host || url.hostname.endsWith(`.${host}`)) &&
      /^\/(?:docx|wiki|base|minutes)\/[a-zA-Z0-9_-]+\/?$/u.test(url.pathname);
  } catch { return false; }
};

@Injectable()
class TaskPromiseEvidenceService {
  constructor(@Inject(TASK_PROMISE_EVIDENCE_REPOSITORY) private readonly repository: TaskPromiseEvidenceRepository) {}

  async list(owner: TaskPromiseEvidenceOwner, rawBefore?: string): Promise<TaskPromiseEvidenceResponse> {
    validateOwner(owner);
    if (rawBefore !== undefined && (!/^[1-9][0-9]*$/u.test(rawBefore) || Number(rawBefore) > 2147483647)) invalid();
    try {
      const result = await this.repository.list({ ...owner,
        beforeRevision: rawBefore === undefined ? undefined : Number(rawBefore), limit: 20 });
      if (result.status === 'found') return result.response;
      this.rejectResult(result.status);
    } catch (error: unknown) { this.rethrow(error, '凭证暂时无法读取'); }
  }

  async record(input: TaskPromiseEvidenceInput): Promise<TaskPromiseEvidenceEvent> {
    validateOwner(input); uuid(input.actorMemberId, input.requestId);
    if (!Number.isInteger(input.expectedRevision) || input.expectedRevision < 0 || input.expectedRevision >= 2147483647 ||
      !['reported_fulfilled', 'reported_partial', 'retracted'].includes(input.state) ||
      typeof input.note !== 'string' || input.note.trim().length < 2 || input.note.trim().length > 500 ||
      input.note.includes('\0') || (input.evidenceUrl !== null && !validEvidenceUrl(input.evidenceUrl)) ||
      (input.state !== 'retracted' && !validEvidenceUrl(input.evidenceUrl))) invalid();
    try {
      const result = await this.repository.record({ ...input,
        requestId: input.requestId.toLowerCase(), note: input.note.trim() });
      if (result.status === 'recorded') return result.event;
      this.rejectResult(result.status);
    } catch (error: unknown) { this.rethrow(error, '凭证暂时无法保存，请使用原请求重试'); }
  }

  private rejectResult(status: string): never {
    if (status === 'not_found') throw new TaskPromiseEvidenceError('NOT_FOUND', '未找到本人的承诺');
    throw new TaskPromiseEvidenceError('CONFLICT', status === 'ineligible' ? '此动作已不符合无任务承诺条件' :
      status === 'request_mismatch' ? '请求编号已用于其他凭证，请刷新状态' : '凭证状态已变化，请刷新后重试');
  }
  private rethrow(error: unknown, message: string): never {
    if (error instanceof TaskPromiseEvidenceError) throw error;
    throw new TaskPromiseEvidenceError('UNAVAILABLE', message);
  }
}
export { TaskPromiseEvidenceError, TaskPromiseEvidenceService };
