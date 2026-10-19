import { expect, it } from 'vitest';
import { resolvePreparationCustomer } from '@server/modules/insight/customer-preparation-customer';

it('matches exact visible names and refuses substring guessing', () => {
  const visible = [{ recordId: 'a', name: '华南科技' }, { recordId: 'b', name: '华南科技分公司' }];
  expect(resolvePreparationCustomer(' 华南科技 ', visible))
    .toEqual({ status: 'matched', candidates: [{ recordId: 'a', name: '华南科技' }] });
  expect(resolvePreparationCustomer('华南', visible)).toEqual({ status: 'not_found', candidates: [] });
});

it('returns same-name candidates without choosing a customer or leaking other names', () => {
  const visible = [{ recordId: 'b', name: '客户甲' }, { recordId: 'a', name: '客户甲' },
    { recordId: 'private', name: '其他客户' }];
  expect(resolvePreparationCustomer('客户甲', visible)).toEqual({ status: 'ambiguous', candidates: [
    { recordId: 'a', name: '客户甲' }, { recordId: 'b', name: '客户甲' },
  ] });
});

it('deduplicates repeated rows and does not accept blank identifiers', () => {
  expect(resolvePreparationCustomer('客户', [{ recordId: '', name: '客户' },
    { recordId: 'a', name: '客户' }, { recordId: 'a', name: '客户' }]))
    .toEqual({ status: 'matched', candidates: [{ recordId: 'a', name: '客户' }] });
  expect(() => resolvePreparationCustomer(' ', [])).toThrow();
});
