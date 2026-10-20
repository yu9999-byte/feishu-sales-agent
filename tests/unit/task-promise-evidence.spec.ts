import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { TaskPromiseEvidenceService } from '@server/modules/insight/task-promise-evidence.service';
import type { TaskPromiseEvidenceInput, TaskPromiseEvidenceRepository } from
  '@server/modules/insight/task-promise-evidence.ports';

const input = (): TaskPromiseEvidenceInput => ({
  tenantId: randomUUID(), actionId: randomUUID(), actorOpenId: 'ou-a', actorMemberId: randomUUID(),
  requestId: randomUUID(), expectedRevision: 0, state: 'reported_fulfilled', note: '方案已经交付',
  evidenceUrl: 'https://example.feishu.cn/docx/doc123',
});
const repository = (): TaskPromiseEvidenceRepository => ({
  list: vi.fn().mockResolvedValue({ status: 'found', response: { revision: 0, current: null,
    history: [], nextBeforeRevision: null } }),
  record: vi.fn().mockResolvedValue({ status: 'conflict' }),
});
describe('task promise evidence service', () => {
  it.each([
    'http://example.feishu.cn/docx/doc123', 'https://feishu.cn.evil.test/docx/doc123',
    'https://name:password@example.feishu.cn/docx/doc123', 'javascript:alert(1)',
    'https://example.feishu.cn/other/doc123', 'https://example.feishu.cn/docx/',
    'https://example.feishu.cn:8443/docx/doc123',
  ])('rejects invalid evidence URL %s without repository writes', async (evidenceUrl) => {
    const repo = repository();
    await expect(new TaskPromiseEvidenceService(repo).record({ ...input(), evidenceUrl }))
      .rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    expect(repo.record).not.toHaveBeenCalled();
  });
  it.each([
    { expectedRevision: -1 }, { expectedRevision: 2147483647 }, { expectedRevision: 0.5 },
    { note: ' ' }, { note: 'a'.repeat(501) }, { state: 'completed' }, { requestId: 'invalid' },
  ])('rejects invalid request %j', async (patch) => {
    await expect(new TaskPromiseEvidenceService(repository()).record(Object.assign(input(), patch)))
      .rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  });
  it('allows supported evidence links and explicit retraction without a URL', async () => {
    for (const evidenceUrl of ['https://example.feishu.cn/wiki/abc', 'https://example.larksuite.com/base/abc',
      'https://meetings.feishu.cn/minutes/abc']) {
      await expect(new TaskPromiseEvidenceService(repository()).record({ ...input(), evidenceUrl }))
        .rejects.toMatchObject({ code: 'CONFLICT' });
    }
    await expect(new TaskPromiseEvidenceService(repository()).record({ ...input(), state: 'retracted', evidenceUrl: null }))
      .rejects.toMatchObject({ code: 'CONFLICT' });
  });
  it('maps ownership and unavailable storage without leaking connection errors', async () => {
    const repo = repository(); const service = new TaskPromiseEvidenceService(repo);
    vi.mocked(repo.record).mockResolvedValue({ status: 'not_found' });
    await expect(service.record(input())).rejects.toMatchObject({ code: 'NOT_FOUND' });
    vi.mocked(repo.record).mockRejectedValue(new Error('password=secret connection host=internal'));
    await expect(service.record(input())).rejects.toMatchObject({ code: 'UNAVAILABLE',
      message: '凭证暂时无法保存，请使用原请求重试' });
  });
  it('validates paging before reading and fixes page size at 20', async () => {
    const repo = repository(); const service = new TaskPromiseEvidenceService(repo); const owner = input();
    for (const raw of ['0', '-1', '1.5', '2147483648']) {
      await expect(service.list(owner, raw)).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    }
    await service.list(owner, '21');
    expect(repo.list).toHaveBeenCalledWith(expect.objectContaining({ limit: 20, beforeRevision: 21 }));
  });
});
