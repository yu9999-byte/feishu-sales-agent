import { describe, expect, it } from 'vitest';
import { parsePreparationDraftEdit } from '@server/modules/insight/preparation-draft-edit';

describe('preparation draft edit boundary', () => {
  const valid = { channel: 'email', subject: '沟通评审', body: '请确认评审安排', expectedRevision: 1 };
  it('accepts an allowlisted edit without changing its text', () => {
    expect(parsePreparationDraftEdit(valid)).toEqual(valid);
  });
  it.each([
    { ...valid, customerId: 'other' }, { ...valid, sourceKeys: ['fake'] },
    { ...valid, expectedRevision: 0 }, { ...valid, expectedRevision: 1.5 },
    { ...valid, expectedRevision: '1' }, { ...valid, expectedRevision: Number.MAX_SAFE_INTEGER + 1 },
    { ...valid, channel: 'sms' }, { ...valid, body: '' }, { ...valid, body: '   ' },
    { ...valid, body: 'a'.repeat(12001) }, { ...valid, subject: 'a'.repeat(301) },
    { ...valid, channel: 'feishu' }, null,
  ])('rejects malformed or unauthorized fields: %j', (input) => {
    expect(() => parsePreparationDraftEdit(input)).toThrow();
  });
});
