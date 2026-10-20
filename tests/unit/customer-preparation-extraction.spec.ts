import { expect, it } from 'vitest';
import { parsePreparationExtraction } from '@server/modules/insight/customer-preparation-extraction';

it('accepts only the three user conditions and normalizes time', () => {
  expect(parsePreparationExtraction({
    customerName: ' 客户甲 ',
    communicationAt: '2026-10-20T14:00:00+08:00',
    purpose: ' 评审接口 ',
  })).toEqual({
    customerName: '客户甲',
    communicationAt: '2026-10-20T06:00:00.000Z',
    purpose: '评审接口',
  });
});

it.each([
  { customerName: '客户', communicationAt: '明天', purpose: null },
  { customerName: '客户', communicationAt: null, purpose: '甲'.repeat(1001) },
  { customerName: '客户', communicationAt: null, purpose: null, customerRecordId: 'c1' },
  { customerName: '客户', communicationAt: null, purpose: null, evidence: [] },
  { customerName: null, communicationAt: null, purpose: null },
])('rejects invalid or untrusted extraction: %j', (value: unknown) => {
  expect(() => parsePreparationExtraction(value)).toThrow();
});
