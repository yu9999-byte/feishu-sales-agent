import { expect, it } from 'vitest';
import type { TodayActionItem } from '@shared/api.interface';
import { todayActionVersion } from '@server/modules/insight/today-action-version';
const item: TodayActionItem = { id: 'task:1', kind: 'task', sourceId: '1',
  customerRecordId: null, title: '报价', reason: '今日到期', evidence: ['客户承诺'],
  suggestedAction: '发送报价', suggestedCompletionDate: '2026-10-16', sourceUrl: null };
it('keeps stable versions for unchanged signals and changes them for new evidence', () => {
  expect(todayActionVersion(item)).toBe(todayActionVersion({ ...item }));
  expect(todayActionVersion(item)).not.toBe(todayActionVersion({ ...item, evidence: ['新的承诺'] }));
});

it('does not inherit old resolved state when the recommendation changes', () => {
  const current = { id: 'task:1', kind: 'task' as const, sourceId: '1', customerRecordId: null,
    title: '报价', reason: '到期', evidence: ['客户承诺'], suggestedAction: '发送报价',
    suggestedCompletionDate: '2026-10-16', sourceUrl: null };
  expect(todayActionVersion(current)).not.toBe(todayActionVersion({ ...current,
    suggestedAction: '先重新确认预算' }));
});

it('changes version when customer association changes despite identical evidence text', () => {
  expect(todayActionVersion(item)).not.toBe(todayActionVersion({ ...item, customerRecordId: 'other-customer' }));
});

it('changes version when the source title changes', () => {
  expect(todayActionVersion(item)).not.toBe(todayActionVersion({ ...item, title: '重新确认报价范围' }));
});
