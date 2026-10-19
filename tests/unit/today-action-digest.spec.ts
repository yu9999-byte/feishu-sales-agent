import { expect, it } from 'vitest';
import { planTodayActionDigest } from '@server/modules/insight/today-action-digest';

it('includes evidence and all signal types while suppressing handled states', () => {
  const state = { itemId: 'one', itemVersion: 'v1', revision: 0, status: 'open' as const, remindAt: null };
  const item = { id: 'one', version: 'v1', kind: 'customer_followup' as const, sourceId: 'source',
    customerRecordId: 'customer', title: '客户甲', reason: '约定今日沟通', evidence: ['客户承诺'],
    suggestedAction: '联系客户', suggestedCompletionDate: '2026-10-17', sourceUrl: null, state };
  const scope = { tenantId: 'tenant', recipientMemberId: 'member', recipientOpenId: 'owner',
    localDate: '2026-10-17', timezone: 'Asia/Shanghai', now: new Date('2026-10-17T01:00:00Z') };
  const result = planTodayActionDigest(scope, [item], ['任务来源暂不可用']);
  expect(JSON.stringify(result)).toContain('客户承诺');
  expect(JSON.stringify(result)).toContain('建议完成时间');
  expect(JSON.stringify(result)).toContain('任务来源暂不可用');
  expect(result?.shortcuts?.[0].value.expectedRevision).toBe(0);
  expect(planTodayActionDigest(scope, [{ ...item, state: { ...state, status: 'resolved' } }], [])).toBeNull();
});
