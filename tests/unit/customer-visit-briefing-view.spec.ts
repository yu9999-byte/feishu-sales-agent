import { describe, expect, it } from 'vitest';

import {
  customerBriefingHealthLabel,
  customerBriefingStatusLabel,
  formatCustomerBriefingAmount,
  formatCustomerBriefingDate,
} from '../../client/src/pages/CustomerVisitBriefingPage/customer-visit-briefing-view';

describe('customer visit briefing view helpers', (): void => {
  it('uses stable user language for status and health', (): void => {
    expect(customerBriefingStatusLabel('partial')).toBe('部分资料可用');
    expect(customerBriefingStatusLabel('unavailable')).toBe('暂时无法准备');
    expect(customerBriefingHealthLabel('critical')).toBe('立即核对');
    expect(customerBriefingHealthLabel(null)).toBe('历史商机');
  });

  it('does not render unknown amount as zero', (): void => {
    expect(formatCustomerBriefingAmount(null)).toBe('金额待确认');
    expect(formatCustomerBriefingAmount(0)).toBe('¥0');
  });

  it('keeps missing and invalid dates visibly unknown', (): void => {
    expect(formatCustomerBriefingDate(null)).toBe('时间待确认');
    expect(formatCustomerBriefingDate('not-a-date')).toBe('时间待确认');
    expect(formatCustomerBriefingDate('2026-10-07T02:00:00.000Z')).toContain(
      '2026',
    );
  });
});
