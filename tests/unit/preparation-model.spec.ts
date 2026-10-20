import { expect, it, vi } from 'vitest';
import { extractPreparationConditions } from '@server/modules/llm/preparation-model';

it('passes bounded conditions and validates model output', async () => {
  const invoke = vi.fn().mockResolvedValue({ customerName: '客户甲', communicationAt: null, purpose: '评审' });
  const result = await extractPreparationConditions({ invoke }, { text: '准备评审', timezone: 'Asia/Shanghai', now: new Date('2026-10-19T00:00:00Z'), previous: null });
  expect(result.purpose).toBe('评审');
  expect(invoke.mock.calls[0][0]).toContain('2026-10-19T00:00:00.000Z');
});

it('rejects injected identifiers returned by the model', async () => {
  const invoke = vi.fn().mockResolvedValue({ customerName: '甲', communicationAt: null, purpose: null, customerRecordId: 'injected' });
  await expect(extractPreparationConditions({ invoke }, { text: '准备沟通', timezone: 'Asia/Shanghai', now: new Date(), previous: null })).rejects.toThrow();
});

it.each(['', '甲'.repeat(12001)])('rejects invalid text before model invocation', async (text) => {
  const invoke = vi.fn();
  await expect(extractPreparationConditions({ invoke }, { text, timezone: 'Asia/Shanghai', now: new Date(), previous: null })).rejects.toThrow();
  expect(invoke).not.toHaveBeenCalled();
});
