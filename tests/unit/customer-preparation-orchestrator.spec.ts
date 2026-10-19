import { describe, expect, it, vi } from 'vitest';
import { CustomerPreparationOrchestratorService } from '@server/modules/insight/customer-preparation-orchestrator.service';

const integration = { tenantId: 'tenant-a', status: 'active', base: { knowledge: { sources: [] } } } as never;

describe('CustomerPreparationOrchestratorService', (): void => {
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
