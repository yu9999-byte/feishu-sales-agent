import { describe, expect, it, vi } from 'vitest';
import { PlaybookDraftReviewService } from '@server/modules/knowledge/playbook-draft-review.service';

const tenantId = '10000000-0000-4000-8000-000000000001';
const candidateId = '20000000-0000-4000-8000-000000000001';
const actorMemberId = '30000000-0000-4000-8000-000000000001';
const valid = { tenantId, candidateId, actorMemberId,
  requestId: '40000000-0000-4000-8000-000000000001', expectedVersion: 1,
  expectedReviewSequence: 0, action: 'submit' as const, note: '  已检查适用范围和证据  ' };

describe('Playbook draft review service', (): void => {
  it('normalizes a human review without accepting client identity', async (): Promise<void> => {
    const record = vi.fn().mockResolvedValue({ status: 'recorded', event: { sequence: 1 } });
    const service = new PlaybookDraftReviewService({ record } as never);
    expect(await service.record(valid)).toEqual({ sequence: 1 });
    expect(record).toHaveBeenCalledWith({ ...valid, note: valid.note.trim() });
  });

  it.each([
    { tenantId: 'bad' }, { candidateId: 'bad' }, { actorMemberId: 'bad' }, { requestId: 'bad' },
    { expectedVersion: 0 }, { expectedVersion: 1.5 }, { expectedVersion: 2147483648 },
    { expectedReviewSequence: -1 }, { expectedReviewSequence: 1.5 }, { expectedReviewSequence: 2147483647 },
    { note: ' ' }, { note: 'x'.repeat(501) }, { note: 'invalid\0note' }, { note: undefined },
    { action: 'publish' },
  ])('rejects %j before any persistence', async (patch): Promise<void> => {
    const record = vi.fn();
    const service = new PlaybookDraftReviewService({ record } as never);
    await expect(service.record({ ...valid, ...patch } as never))
      .rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    expect(record).not.toHaveBeenCalled();
  });

  it.each(['not_found', 'conflict', 'not_accepted', 'request_mismatch', 'invalid_transition'])
  ('maps %s without claiming an approval', async (status): Promise<void> => {
    const service = new PlaybookDraftReviewService({ record: vi.fn().mockResolvedValue({ status }) } as never);
    await expect(service.record(valid)).rejects.toMatchObject({ code: status === 'not_found' ? 'NOT_FOUND' : 'CONFLICT' });
  });

  it('hides persistence errors', async (): Promise<void> => {
    const service = new PlaybookDraftReviewService({ record: vi.fn().mockRejectedValue(new Error('secret raw content')) } as never);
    await expect(service.record(valid)).rejects.toMatchObject({ code: 'UNAVAILABLE' });
    await expect(service.record(valid)).rejects.not.toThrow('secret');
  });

  it.each(['0', '1.5', '2147483648', 'invalid'])('rejects invalid history cursor %s', async (raw): Promise<void> => {
    const list = vi.fn();
    const service = new PlaybookDraftReviewService({ list } as never);
    await expect(service.list(tenantId, candidateId, raw)).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    expect(list).not.toHaveBeenCalled();
  });

  it('bounds history and distinguishes missing candidates', async (): Promise<void> => {
    const response = { latestDraftVersion: null, status: 'not_submitted', current: null, history: [], nextBeforeSequence: null };
    const list = vi.fn().mockResolvedValueOnce(response).mockResolvedValueOnce(null);
    const service = new PlaybookDraftReviewService({ list } as never);
    expect(await service.list(tenantId, candidateId, '21')).toEqual(response);
    expect(list).toHaveBeenCalledWith({ tenantId, candidateId, beforeSequence: 21, limit: 20 });
    await expect(service.list(tenantId, candidateId)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});
