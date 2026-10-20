import { Inject, Injectable } from '@nestjs/common';
import type { PlaybookDraftResponse, PlaybookDraftVersion } from '@shared/api.interface';
import {
  PLAYBOOK_AUTHORING_REPOSITORY,
  type PlaybookAuthoringRepository, type PlaybookDraftSaveInput,
} from './playbook-authoring.ports';

class PlaybookAuthoringError extends Error {
  constructor(
    readonly code: 'VALIDATION_FAILED' | 'NOT_FOUND' | 'CONFLICT' | 'UNAVAILABLE',
    message: string,
  ) { super(message); }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const invalid = (): never => {
  throw new PlaybookAuthoringError('VALIDATION_FAILED', '草稿参数无效，请检查内容和版本');
};
const identity = (...values: string[]): void => {
  if (values.some((value: string): boolean => typeof value !== 'string' || !UUID.test(value))) invalid();
};
const versionNumber = (raw: string): number => {
  if (typeof raw !== 'string' || !/^[1-9][0-9]*$/u.test(raw)) invalid();
  const value: number = Number(raw);
  if (!Number.isSafeInteger(value) || value > 2147483647) invalid();
  return value;
};
const text = (value: unknown, min: number, max: number): string => {
  if (typeof value !== 'string') return invalid();
  const normalized: string = value.trim();
  if (normalized.length < min || normalized.length > max || normalized.includes('\0')) invalid();
  return normalized;
};

@Injectable()
class PlaybookAuthoringService {
  constructor(@Inject(PLAYBOOK_AUTHORING_REPOSITORY) private readonly repository: PlaybookAuthoringRepository) {}

  async list(tenantId: string, candidateId: string, rawBefore?: string): Promise<PlaybookDraftResponse> {
    identity(tenantId, candidateId);
    const beforeVersion: number | undefined = rawBefore === undefined ? undefined : versionNumber(rawBefore);
    try {
      const result = await this.repository.list({ tenantId, candidateId, beforeVersion, limit: 20 });
      if (result === null) throw new PlaybookAuthoringError('NOT_FOUND', '候选不存在');
      return result;
    } catch (error: unknown) { this.rethrow(error, '草稿暂时无法读取'); }
  }

  async get(tenantId: string, candidateId: string, rawVersion: string): Promise<PlaybookDraftVersion> {
    identity(tenantId, candidateId);
    const version: number = versionNumber(rawVersion);
    try {
      const result = await this.repository.get({ tenantId, candidateId, version });
      if (result === null) throw new PlaybookAuthoringError('NOT_FOUND', '草稿版本不存在');
      return result;
    } catch (error: unknown) { this.rethrow(error, '草稿版本暂时无法读取'); }
  }

  async save(input: PlaybookDraftSaveInput): Promise<PlaybookDraftVersion> {
    identity(input.tenantId, input.candidateId, input.authorMemberId, input.requestId);
    if (!Number.isInteger(input.expectedVersion) || input.expectedVersion < 0 ||
      input.expectedVersion >= 2147483647) invalid();
    const normalized: PlaybookDraftSaveInput = {
      ...input, requestId: input.requestId.toLowerCase(),
      title: text(input.title, 2, 120), body: text(input.body, 10, 20000),
      applicability: text(input.applicability, 2, 1000), changeNote: text(input.changeNote, 2, 500),
    };
    try {
      const result = await this.repository.save(normalized);
      if (result.status === 'saved') return result.version;
      if (result.status === 'not_found') throw new PlaybookAuthoringError('NOT_FOUND', '候选不存在');
      const message: string = result.status === 'not_accepted' ? '仅已接受的候选可以编写草稿' :
        result.status === 'request_mismatch' ? '请求编号已用于其他内容，请读取最新版本后重新保存' :
          '草稿已有新版本，请读取后选择要保留的内容';
      throw new PlaybookAuthoringError('CONFLICT', message);
    } catch (error: unknown) { this.rethrow(error, '草稿暂时无法保存，请使用原请求重试'); }
  }

  private rethrow(error: unknown, message: string): never {
    if (error instanceof PlaybookAuthoringError) throw error;
    throw new PlaybookAuthoringError('UNAVAILABLE', message);
  }
}

export { PlaybookAuthoringService, PlaybookAuthoringError };
