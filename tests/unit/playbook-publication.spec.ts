import { describe, expect, it, vi } from 'vitest';
import { PlaybookPublicationService } from '@server/modules/knowledge/playbook-publication.service';

const tenantId = '10000000-0000-4000-8000-000000000001';
const candidateId = '20000000-0000-4000-8000-000000000001';
const actorMemberId = '30000000-0000-4000-8000-000000000001';
const valid = { tenantId, candidateId, actorMemberId, action: 'publish' as const,
  requestId: '40000000-0000-4000-8000-00000000000A', expectedVersion: 1,
  expectedReviewSequence: 2, expectedPublicationSequence: 0, note: '  复核完成后发布  ' };

describe('Playbook publication service', (): void => {
  it('normalizes the note and request identity', async (): Promise<void> => {
    const record = vi.fn().mockResolvedValue({ status: 'recorded', event: { sequence: 1 } });
    const service = new PlaybookPublicationService({ record } as never);
    expect(await service.record(valid)).toEqual({ sequence: 1 });
    expect(record).toHaveBeenCalledWith({ ...valid, requestId: valid.requestId.toLowerCase(), note: valid.note.trim() });
  });
  it.each([
    { tenantId: 'bad' }, { candidateId: 'bad' }, { actorMemberId: 'bad' }, { requestId: 'bad' },
    { expectedVersion: 0 }, { expectedVersion: 1.5 }, { expectedVersion: 2147483648 },
    { expectedPublicationSequence: -1 }, { expectedPublicationSequence: 1.5 }, { expectedPublicationSequence: 2147483647 },
    { expectedReviewSequence: null }, { expectedReviewSequence: 0 }, { expectedReviewSequence: 1.5 },
    { expectedReviewSequence: 2147483648 }, { action: 'approve' }, { note: '' }, { note: undefined },
    { note: 'x'.repeat(501) }, { note: 'invalid\0note' }, { action: 'withdraw', expectedReviewSequence: 2 },
  ])('rejects invalid inputs before persistence: %j', async (patch): Promise<void> => {
    const record = vi.fn();
    const service = new PlaybookPublicationService({ record } as never);
    await expect(service.record({ ...valid, ...patch } as never)).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    expect(record).not.toHaveBeenCalled();
  });
  it('withdraws without requiring a current review sequence', async (): Promise<void> => {
    const record = vi.fn().mockResolvedValue({ status: 'recorded', event: { action: 'withdraw' } });
    const service = new PlaybookPublicationService({ record } as never);
    expect(await service.record({ ...valid, action: 'withdraw', expectedReviewSequence: null })).toEqual({ action: 'withdraw' });
  });
  it.each(['not_found', 'not_accepted', 'conflict', 'request_mismatch', 'invalid_transition'])
  ('maps persistence outcome %s', async (status): Promise<void> => {
    const service = new PlaybookPublicationService({ record: vi.fn().mockResolvedValue({ status }) } as never);
    await expect(service.record(valid)).rejects.toMatchObject({ code: status === 'not_found' ? 'NOT_FOUND' : 'CONFLICT' });
  });
  it.each(['0', '-1', '1.5', '2147483648', 'invalid'])('rejects history cursor %s', async (raw): Promise<void> => {
    const list = vi.fn();
    await expect(new PlaybookPublicationService({ list } as never).list(tenantId, candidateId, raw))
      .rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    expect(list).not.toHaveBeenCalled();
  });
  it('bounds history and catalog reads and rejects invalid catalog cursors', async (): Promise<void> => {
    const list = vi.fn().mockResolvedValue(null);
    const listPublished = vi.fn().mockResolvedValue({ items: [], nextAfterCandidateId: null });
    const service = new PlaybookPublicationService({ list, listPublished } as never);
    await expect(service.list(tenantId, candidateId, '21')).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(list).toHaveBeenCalledWith({ tenantId, candidateId, beforeSequence: 21, limit: 20 });
    expect(await service.listPublished(tenantId)).toEqual({ items: [], nextAfterCandidateId: null });
    expect(listPublished).toHaveBeenCalledWith({ tenantId, afterCandidateId: undefined, limit: 20 });
    await expect(service.listPublished(tenantId, 'invalid')).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  });
  it('treats unpublished content as absent and hides raw persistence failures', async (): Promise<void> => {
    const service = new PlaybookPublicationService({ getPublished: vi.fn().mockResolvedValueOnce(null)
      .mockRejectedValueOnce(new Error('secret raw content')) } as never);
    await expect(service.getPublished(tenantId, candidateId)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(service.getPublished(tenantId, candidateId)).rejects.toMatchObject({
      code: 'UNAVAILABLE', message: expect.not.stringContaining('secret'),
    });
  });
});
