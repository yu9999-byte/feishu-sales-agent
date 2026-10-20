import { describe, expect, it, vi } from 'vitest';
import { CustomerPreparationOrchestratorService } from '@server/modules/insight/customer-preparation-orchestrator.service';

const integration = { tenantId: 'tenant-a', status: 'active', base: { knowledge: { sources: [] } } } as never;

describe('CustomerPreparationOrchestratorService', (): void => {
  it.each([true, false])('revalidates selected same-name customer visibility (%s)', async (visible) => {
    const access = { resolve: vi.fn().mockResolvedValue({ status: 'ambiguous', candidates: [
      { recordId: 'c1', name: '华南科技' },
      ...(visible ? [{ recordId: 'c2', name: '华南科技' }] : []),
    ] }) };
    const generate = vi.fn().mockResolvedValue({ status: 'partial' });
    const service = new CustomerPreparationOrchestratorService(access as never, { generate } as never);
    const result = await service.prepare({ integration, actorOpenId: 'user-a',
      request: { customerName: '华南科技', communicationAt: '2026-10-20T10:00:00+08:00', purpose: '确认接口' },
      selectedCustomerRecordId: 'c2', timezone: 'Asia/Shanghai', now: new Date() });
    expect(access.resolve).toHaveBeenCalledWith(integration, 'user-a', '华南科技');
    if (visible) {
      expect(result.status).toBe('ready');
      expect(generate).toHaveBeenCalledWith(expect.objectContaining({ customerRecordId: 'c2' }));
    } else {
      expect(result.status).toBe('clarification_required');
      expect(generate).not.toHaveBeenCalled();
    }
  });

  it.each([
    ['Asia/Shanghai', '2026-10-20T20:30:00Z', '2026-10-21'],
    ['America/Los_Angeles', '2026-10-20T01:30:00Z', '2026-10-19'],
  ])('uses the communication date in %s', async (timezone, communicationAt, referenceDate) => {
    const access = { resolve: vi.fn().mockResolvedValue({ status: 'matched', candidates: [{ recordId: 'c1', name: '华南科技' }] }) };
    const preparations = { generate: vi.fn().mockResolvedValue({ status: 'partial' }) };
    const service = new CustomerPreparationOrchestratorService(access as never, preparations as never);
    const result = await service.prepare({ integration, actorOpenId: 'user-a', request: { customerName: '华南科技', communicationAt, purpose: '确认接口' }, timezone, now: new Date() });
    expect(preparations.generate).toHaveBeenCalledWith(expect.objectContaining({ referenceDate, timezone, customerRecordId: 'c1', purpose: '确认接口' }));
    expect(result).toMatchObject({ status: 'ready', preparation: { status: 'partial' } });
  });

  it.each(['unavailable', 'throw'])('does not report ready when generation is %s', async (mode) => {
    const access = { resolve: vi.fn().mockResolvedValue({ status: 'matched', candidates: [{ recordId: 'c1', name: '华南科技' }] }) };
    const generate = vi.fn();
    if (mode === 'throw') generate.mockRejectedValue(new Error('source failed'));
    else generate.mockResolvedValue({ status: 'unavailable' });
    const service = new CustomerPreparationOrchestratorService(access as never, { generate } as never);
    await expect(service.prepare({ integration, actorOpenId: 'user-a', request: { customerName: '华南科技', communicationAt: '2026-10-20T10:00:00+08:00', purpose: '确认接口' }, timezone: 'Asia/Shanghai', now: new Date() }))
      .resolves.toEqual({ status: 'unavailable', reason: 'source_unavailable' });
  });

  it('rejects invalid timezone before reading customer data', async () => {
    const access = { resolve: vi.fn() };
    const preparations = { generate: vi.fn() };
    const service = new CustomerPreparationOrchestratorService(access as never, preparations as never);
    await expect(service.prepare({ integration, actorOpenId: 'user-a', request: { customerName: '华南科技', communicationAt: '2026-10-20T10:00:00+08:00', purpose: '确认接口' }, timezone: 'Invalid/Zone', now: new Date() })).rejects.toThrow(RangeError);
    expect(access.resolve).not.toHaveBeenCalled();
  });

  it('requires missing preparation fields before reading records', async (): Promise<void> => {
    const access = { resolve: vi.fn() };
    const preparations = { generate: vi.fn() };
    const service = new CustomerPreparationOrchestratorService(access as never, preparations as never);
    await expect(service.prepare({ integration, actorOpenId: 'user-a', request: { customerName: '华南科技', communicationAt: null, purpose: null }, timezone: 'Asia/Shanghai', now: new Date() }))
      .resolves.toMatchObject({ status: 'clarification_required', reason: 'missing_fields' });
    expect(access.resolve).not.toHaveBeenCalled();
  });

  it('returns same-name candidates without generating a preparation', async (): Promise<void> => {
    const access = { resolve: vi.fn().mockResolvedValue({ status: 'ambiguous', coverage: 'complete', candidates: [{ recordId: 'c1', name: '华南科技' }, { recordId: 'c2', name: '华南科技' }] }) };
    const preparations = { generate: vi.fn() };
    const service = new CustomerPreparationOrchestratorService(access as never, preparations as never);
    const result = await service.prepare({ integration, actorOpenId: 'user-a', request: { customerName: '华南科技', communicationAt: '2026-10-20T10:00:00+08:00', purpose: '确认接口' }, timezone: 'Asia/Shanghai', now: new Date() });
    expect(result).toMatchObject({ status: 'clarification_required', reason: 'ambiguous' });
    expect(preparations.generate).not.toHaveBeenCalled();
  });
});
