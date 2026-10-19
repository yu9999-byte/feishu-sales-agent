import { expect, it, vi } from 'vitest';
import { TodayActionService } from '@server/modules/insight/today-action.service';

it('passes an unavailable snapshot after task failure instead of allowing an implicit second read', async () => {
  const records = { readOpportunityPortfolio: vi.fn().mockResolvedValue({ warnings: [], followups: [] }) };
  const tasks = { analyze: vi.fn().mockRejectedValue(new Error('offline')) };
  const decisions = { analyze: vi.fn().mockResolvedValue({ status: 'partial', warnings: [], priorities: [] }) };
  const service = new TodayActionService(records as never, tasks as never, decisions as never);
  const result = await service.analyze({ integration: { status: 'active' } as never,
    actorOpenId: 'actor', referenceDate: '2026-10-16', timezone: 'Asia/Shanghai' });
  expect(decisions.analyze).toHaveBeenCalledWith(expect.objectContaining({
    taskReport: expect.objectContaining({ status: 'unavailable', items: [], promises: [] }),
  }));
  expect(result.coverage.tasks).toBe('unavailable');
  expect(tasks.analyze).toHaveBeenCalledTimes(1);
});

it('marks incomplete evidence references as partial coverage', async () => {
  const records = { readOpportunityPortfolio: vi.fn().mockResolvedValue({ warnings: [], followups: [] }) };
  const tasks = { analyze: vi.fn().mockResolvedValue({ status: 'ready', items: [], warnings: [] }) };
  const decisions = { analyze: vi.fn().mockResolvedValue({ status: 'ready', warnings: [], priorities: [{
    recordId: 'o', lifecycleStatus: 'open', risks: [{ title: '停滞', evidenceIds: ['missing'] }],
    gaps: [], evidence: [],
  }] }) };
  const service = new TodayActionService(records as never, tasks as never, decisions as never);
  const result = await service.analyze({ integration: { status: 'active' } as never,
    actorOpenId: 'actor', referenceDate: '2026-10-16', timezone: 'Asia/Shanghai' });
  expect(result.status).toBe('partial');
  expect(result.coverage.portfolio).toBe('partial');
  expect(result.warnings).toContain('部分商机信号缺少关联证据，未生成行动事项');
});

it('reports partial coverage when a recommendation cites unavailable evidence', async () => {
  const records = { readOpportunityPortfolio: vi.fn().mockResolvedValue({ warnings: [], followups: [] }) };
  const tasks = { analyze: vi.fn().mockResolvedValue({ status: 'ready', items: [], warnings: [] }) };
  const decisions = { analyze: vi.fn().mockResolvedValue({ status: 'ready', warnings: [], priorities: [{
    recordId: 'o', name: '商机', lifecycleStatus: 'open', risks: [{ title: '停滞', evidenceIds: ['e'] }],
    gaps: [], evidence: [{ id: 'e', label: '记录', value: '14天未沟通' }],
    recommendation: { action: '无证据建议', dueAt: '2026-10-30T00:00:00Z', evidenceIds: ['missing'] },
  }] }) };
  const service = new TodayActionService(records as never, tasks as never, decisions as never);
  const result = await service.analyze({ integration: { status: 'active' } as never,
    actorOpenId: 'actor', referenceDate: '2026-10-16', timezone: 'Asia/Shanghai' });
  expect(result.coverage.portfolio).toBe('partial');
  expect(result.warnings).toContain('部分商机建议缺少关联证据，已改为核实信息');
  expect(result.items[0].suggestedAction).toBe('核实并补充商机信息');
});

it('returns unavailable without reading sources for an inactive integration', async () => {
  const service = new TodayActionService({} as never, {} as never, {} as never);
  const result = await service.analyze({ integration: { status: 'inactive' } as never,
    actorOpenId: 'actor', referenceDate: '2026-10-16', timezone: 'Asia/Shanghai' });
  expect(result.status).toBe('unavailable');
  expect(result.items).toEqual([]);
});

it('keeps source failures visible instead of claiming an empty day', async () => {
  const records = { readOpportunityPortfolio: vi.fn().mockRejectedValue(new Error('offline')) };
  const tasks = { analyze: vi.fn().mockRejectedValue(new Error('offline')) };
  const decisions = { analyze: vi.fn() };
  const service = new TodayActionService(records as never, tasks as never, decisions as never);
  const result = await service.analyze({ integration: { status: 'active' } as never,
    actorOpenId: 'actor', referenceDate: '2026-10-16', timezone: 'Asia/Shanghai' });
  expect(result.status).toBe('unavailable');
  expect(result.warnings).toHaveLength(2);
  expect(decisions.analyze).not.toHaveBeenCalled();
  expect(tasks.analyze).toHaveBeenCalledWith(expect.objectContaining({ readOnly: true, actorOpenId: 'actor' }));
});

it('validates the business date before reading external sources', async () => {
  const records = { readOpportunityPortfolio: vi.fn().mockRejectedValue(new Error('offline')) };
  const tasks = { analyze: vi.fn().mockRejectedValue(new Error('offline')) };
  const service = new TodayActionService(records as never, tasks as never, {} as never);
  await expect(service.analyze({ integration: { status: 'active' } as never,
    actorOpenId: 'actor', referenceDate: 'invalid', timezone: 'Asia/Shanghai' })).rejects.toThrow();
  expect(records.readOpportunityPortfolio).not.toHaveBeenCalled();
  expect(tasks.analyze).not.toHaveBeenCalled();
});

it('retains a visible partial status when only portfolio is unavailable', async () => {
  const records = { readOpportunityPortfolio: vi.fn().mockRejectedValue(new Error('offline')) };
  const tasks = { analyze: vi.fn().mockResolvedValue({ status: 'ready', items: [], warnings: [] }) };
  const service = new TodayActionService(records as never, tasks as never, {} as never);
  const result = await service.analyze({ integration: { status: 'active' } as never,
    actorOpenId: 'actor', referenceDate: '2026-10-16', timezone: 'Asia/Shanghai' });
  expect(result.status).toBe('partial');
  expect(result.coverage).toEqual({ tasks: 'complete', portfolio: 'unavailable' });
});

it('never exposes private source exception details in warnings', async () => {
  const records = { readOpportunityPortfolio: vi.fn().mockRejectedValue(new Error('secret-token-customer-text')) };
  const tasks = { analyze: vi.fn().mockRejectedValue(new Error('secret-token-customer-text')) };
  const service = new TodayActionService(records as never, tasks as never, {} as never);
  const result = await service.analyze({ integration: { status: 'active' } as never,
    actorOpenId: 'actor', referenceDate: '2026-10-16', timezone: 'Asia/Shanghai' });
  expect(JSON.stringify(result)).not.toContain('secret-token-customer-text');
});

it('does not read any source when authenticated actor identity is empty', async () => {
  const records = { readOpportunityPortfolio: vi.fn() };
  const tasks = { analyze: vi.fn() };
  const service = new TodayActionService(records as never, tasks as never, {} as never);
  const result = await service.analyze({ integration: { status: 'active' } as never,
    actorOpenId: ' ', referenceDate: '2026-10-16', timezone: 'Asia/Shanghai' });
  expect(result.status).toBe('unavailable');
  expect(records.readOpportunityPortfolio).not.toHaveBeenCalled();
  expect(tasks.analyze).not.toHaveBeenCalled();
});
