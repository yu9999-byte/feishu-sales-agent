import { describe, expect, it, vi } from 'vitest';
import { PlaybookAdoptionService } from '@server/modules/knowledge/playbook-adoption.service';

const tenantId = '10000000-0000-4000-8000-000000000001';
const candidateId = '20000000-0000-4000-8000-000000000001';
const actorMemberId = '30000000-0000-4000-8000-000000000001';
const actionId = '40000000-0000-4000-8000-000000000001';
const valid = {
  tenantId, candidateId, actorMemberId, actorOpenId: 'ou_sales_a', requestId: '50000000-0000-4000-8000-00000000000A',
  expectedAdoptionSequence: 0, publicationVersion: 1, publicationSequence: 2, action: 'record' as const,
  evidence: { kind: 'followup' as const, recordId: 'rec-followup', actionId, note: '已写入真实跟进记录' }, note: '已在客户沟通后采用',
};

describe('Playbook adoption service', (): void => {
  it('normalizes request and evidence text before persistence', async (): Promise<void> => {
    const record = vi.fn().mockResolvedValue({ status: 'recorded', event: { sequence: 1 } });
    const service = new PlaybookAdoptionService({ record } as never);
    expect(await service.record({ ...valid, note: `  ${valid.note}  `,
      evidence: { ...valid.evidence, actionId: actionId.toUpperCase(), note: ` ${valid.evidence.note} ` } })).toEqual({ sequence: 1 });
    expect(record).toHaveBeenCalledWith(expect.objectContaining({ requestId: valid.requestId.toLowerCase(), note: valid.note,
      evidence: { ...valid.evidence, actionId, note: valid.evidence.note } }));
  });
  it.each([
    { tenantId: 'bad' }, { candidateId: 'bad' }, { actorMemberId: 'bad' }, { requestId: 'bad' },
    { actorOpenId: '' }, { expectedAdoptionSequence: -1 }, { publicationVersion: 0 }, { publicationSequence: 0 },
    { action: 'approve' }, { note: '' }, { note: 'x'.repeat(501) }, { evidence: null },
    { evidence: { ...valid.evidence, kind: 'other' } }, { evidence: { ...valid.evidence, actionId: 'bad' } },
    { evidence: { ...valid.evidence, recordId: '' } }, { evidence: { ...valid.evidence, note: '' } },
  ])('rejects invalid input before persistence: %j', async (patch): Promise<void> => {
    const record = vi.fn();
    const service = new PlaybookAdoptionService({ record } as never);
    await expect(service.record({ ...valid, ...patch } as never)).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    expect(record).not.toHaveBeenCalled();
  });
  it('requires null evidence when retracting', async (): Promise<void> => {
    const record = vi.fn().mockResolvedValue({ status: 'recorded', event: { action: 'retract' } });
    const service = new PlaybookAdoptionService({ record } as never);
    await expect(service.record({ ...valid, action: 'retract', evidence: null })).resolves.toEqual({ action: 'retract' });
    await expect(service.record({ ...valid, action: 'retract' })).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  });
  it.each(['not_found', 'no_publication', 'conflict', 'request_mismatch', 'invalid_transition', 'invalid_evidence'])
  ('maps persistence outcome %s', async (status): Promise<void> => {
    const service = new PlaybookAdoptionService({ record: vi.fn().mockResolvedValue({ status }) } as never);
    await expect(service.record(valid)).rejects.toMatchObject({ code: status === 'not_found' ? 'NOT_FOUND' : 'CONFLICT' });
  });
  it('bounds history reads and hides repository failures', async (): Promise<void> => {
    const list = vi.fn().mockResolvedValue({ adoptionSequence: 0, history: [] });
    const service = new PlaybookAdoptionService({ list } as never);
    expect(await service.list(tenantId, candidateId, '4')).toEqual({ adoptionSequence: 0, history: [] });
    expect(list).toHaveBeenCalledWith({ tenantId, candidateId, beforeSequence: 4, limit: 20 });
    await expect(service.list(tenantId, candidateId, '0')).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    const failed = new PlaybookAdoptionService({ list: vi.fn().mockRejectedValue(new Error('secret')) } as never);
    await expect(failed.list(tenantId, candidateId)).rejects.toMatchObject({ code: 'UNAVAILABLE', message: expect.not.stringContaining('secret') });
  });
});
