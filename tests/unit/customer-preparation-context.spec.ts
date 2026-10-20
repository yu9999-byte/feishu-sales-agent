import { expect, it } from 'vitest';
import { mergePreparationConditions } from '@server/modules/insight/customer-preparation-context';

it('merges missing conditions across turns without inventing values', () => {
  const first = mergePreparationConditions(null, { customerName: ' 客户甲 ' }, 1, 20);
  expect(first).toEqual({ customerName: '客户甲', communicationAt: null, purpose: null });
  expect(mergePreparationConditions(first, { purpose: '接口评审', communicationAt: '2026-10-20T10:00:00+08:00' }, 2, 50))
    .toEqual({ customerName: '客户甲', communicationAt: '2026-10-20T02:00:00.000Z', purpose: '接口评审' });
});

it('clears explicitly removed conditions and stale customer conditions', () => {
  const previous = { customerName: '甲', communicationAt: '2026-10-20T02:00:00.000Z', purpose: '评审' };
  expect(mergePreparationConditions(previous, { purpose: null }, 2, 50).purpose).toBeNull();
  expect(mergePreparationConditions(previous, { customerName: '乙' }, 2, 50))
    .toEqual({ customerName: '乙', communicationAt: null, purpose: null });
  expect(mergePreparationConditions(previous, { customerName: '乙', purpose: '报价' }, 2, 50).purpose).toBe('报价');
});

it.each([
  [{ customerRecordId: 'injected' }, 1, 20],
  [{ communicationAt: '明天' }, 1, 20],
  [{ purpose: '甲'.repeat(1001) }, 1, 20],
  [{}, 9, 20],
  [{}, 1, 12001],
  [{}, 0, 20],
  [{}, 1, -1],
])('rejects untrusted patches and exceeded context bounds', (patch, turnCount, rawTextLength) => {
  expect(() => mergePreparationConditions(null, patch, turnCount, rawTextLength)).toThrow();
});
