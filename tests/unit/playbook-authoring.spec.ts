import { describe, expect, it, vi } from 'vitest';
import { PlaybookAuthoringService, PlaybookAuthoringError } from
  '@server/modules/knowledge/playbook-authoring.service';

const tenantId = '10000000-0000-4000-8000-000000000001';
const candidateId = '20000000-0000-4000-8000-000000000001';
const authorMemberId = '30000000-0000-4000-8000-000000000001';
const valid = {
  tenantId, candidateId, authorMemberId,
  requestId: '40000000-0000-4000-8000-000000000001',
  expectedVersion: 0, title: '  接口实施范围  ',
  body: '  实施前核实双方接口与验收范围。  ',
  applicability: '  技术评审阶段  ', changeNote: '  创建初版  ',
};

describe('Playbook authoring service', (): void => {
  it('normalizes human input and passes trusted context to the repository', async (): Promise<void> => {
    const save = vi.fn().mockResolvedValue({ status: 'saved', version: { version: 1 } });
    const service = new PlaybookAuthoringService({ save } as never);
    expect(await service.save(valid)).toEqual({ version: 1 });
    expect(save).toHaveBeenCalledWith({
      ...valid, title: '接口实施范围', body: '实施前核实双方接口与验收范围。',
      applicability: '技术评审阶段', changeNote: '创建初版',
    });
  });

  it.each([
    { expectedVersion: -1 }, { expectedVersion: 1.1 }, { expectedVersion: 2147483647 },
    { requestId: 'invalid' }, { candidateId: 'invalid' }, { tenantId: 'invalid' },
    { authorMemberId: 'invalid' }, { title: ' ' }, { title: 'x'.repeat(121) },
    { body: 'short' }, { body: 'x'.repeat(20001) }, { applicability: ' ' },
    { applicability: 'x'.repeat(1001) }, { changeNote: ' ' },
    { changeNote: 'x'.repeat(501) }, { body: 'valid text with\0null' },
    { title: undefined },
  ])('rejects malformed input %j before writing', async (patch): Promise<void> => {
    const save = vi.fn();
    const service = new PlaybookAuthoringService({ save } as never);
    await expect(service.save({ ...valid, ...patch } as never))
      .rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    expect(save).not.toHaveBeenCalled();
  });

  it.each([
    ['not_found', 'NOT_FOUND'], ['conflict', 'CONFLICT'],
    ['not_accepted', 'CONFLICT'], ['request_mismatch', 'CONFLICT'],
  ])('maps %s without claiming a save', async (status, code): Promise<void> => {
    const service = new PlaybookAuthoringService({
      save: vi.fn().mockResolvedValue({ status }),
    } as never);
    await expect(service.save(valid)).rejects.toMatchObject({ code });
  });

  it('sanitizes persistence failures', async (): Promise<void> => {
    const service = new PlaybookAuthoringService({
      save: vi.fn().mockRejectedValue(new Error('postgres://secret human body')),
    } as never);
    await expect(service.save(valid)).rejects.toEqual(new PlaybookAuthoringError(
      'UNAVAILABLE', '草稿暂时无法保存，请使用原请求重试',
    ));
  });

  it.each(['0', '-1', '1.5', '1e2', '2147483648', 'abc'])('rejects invalid cursor %s', async (cursor): Promise<void> => {
    const list = vi.fn();
    const service = new PlaybookAuthoringService({ list } as never);
    await expect(service.list(tenantId, candidateId, cursor))
      .rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    expect(list).not.toHaveBeenCalled();
  });

  it('bounds history and distinguishes an empty draft from a missing candidate', async (): Promise<void> => {
    const response = { latest: null, history: [], nextBeforeVersion: null };
    const list = vi.fn().mockResolvedValueOnce(response).mockResolvedValueOnce(null);
    const service = new PlaybookAuthoringService({ list } as never);
    expect(await service.list(tenantId, candidateId, '21')).toEqual(response);
    expect(list).toHaveBeenCalledWith({ tenantId, candidateId, beforeVersion: 21, limit: 20 });
    await expect(service.list(tenantId, candidateId)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});
