import { describe, expect, it } from 'vitest';
import { summarizeTodayCoverage } from '@server/modules/insight/today-action-coverage';

describe('today action source coverage', () => {
  it('never presents unavailable sources as an empty successful day', () => {
    expect(summarizeTodayCoverage({ tasks: 'unavailable', portfolio: 'unavailable' }, 0))
      .toBe('unavailable');
    expect(summarizeTodayCoverage({ tasks: 'complete', portfolio: 'unavailable' }, 0))
      .toBe('partial');
    expect(summarizeTodayCoverage({ tasks: 'complete', portfolio: 'complete' }, 0))
      .toBe('empty');
    expect(summarizeTodayCoverage({ tasks: 'complete', portfolio: 'complete' }, 2))
      .toBe('ready');
  });
});
