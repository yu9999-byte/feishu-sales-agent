import type { TodayActionResponse, TodayActionSourceCoverage } from '@shared/api.interface';

const summarizeTodayCoverage = (
  coverage: TodayActionSourceCoverage,
  itemCount: number,
): TodayActionResponse['status'] => {
  if (coverage.tasks === 'unavailable' && coverage.portfolio === 'unavailable') {
    return 'unavailable';
  }
  if (coverage.tasks !== 'complete' || coverage.portfolio !== 'complete') return 'partial';
  return itemCount > 0 ? 'ready' : 'empty';
};

export { summarizeTodayCoverage };
