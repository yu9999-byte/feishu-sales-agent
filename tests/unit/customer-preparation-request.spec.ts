import { expect, it } from 'vitest';
import { parseCustomerPreparationRequest } from '@server/modules/insight/customer-preparation-request';

it('normalizes user conditions without inventing missing time or purpose', () => {
  expect(parseCustomerPreparationRequest({ customerName: ' 客户甲 ', communicationAt: null,
    purpose: '  ' })).toEqual({ customerName: '客户甲', communicationAt: null, purpose: null });
  expect(parseCustomerPreparationRequest({ customerName: '客户甲',
    communicationAt: '2026-10-20T14:00:00+08:00', purpose: ' 评审接口 ' }))
    .toEqual({ customerName: '客户甲', communicationAt: '2026-10-20T06:00:00.000Z', purpose: '评审接口' });
});

it.each([
  { customerName: ' ' },
  { customerName: '甲'.repeat(201) },
  { customerName: '客户', purpose: '甲'.repeat(1001) },
  { customerName: '客户', communicationAt: '2026-10-20T14:00:00' },
  { customerName: '客户', communicationAt: '2027-02-30T14:00:00Z' },
  { customerName: '客户', customerRecordId: 'untrusted-id' },
  { customerName: '客户', evidence: ['fabricated'] },
])('rejects malformed or untrusted request fields: %j', (input: unknown) => {
  expect(() => parseCustomerPreparationRequest(input)).toThrow();
});
