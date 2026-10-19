import { afterEach, expect, it, vi } from 'vitest';
import { startTodayTaskPolling } from '../../client/src/pages/TodayActionPage/today-task-poll';
import type { TodayActionTaskStatusResponse } from '@shared/api.interface';

afterEach(() => { vi.useRealTimers(); });

it('reads through execution to success and stops at the terminal result', async () => {
  vi.useFakeTimers();
  const read = vi.fn().mockResolvedValueOnce({ actionId: 'one', status: 'executing' })
    .mockResolvedValue({ actionId: 'one', status: 'succeeded' });
  const publish = vi.fn();
  startTodayTaskPolling('one', read, publish, vi.fn());
  await vi.advanceTimersByTimeAsync(10000);
  expect(read).toHaveBeenCalledTimes(2);
  expect(publish).toHaveBeenLastCalledWith({ actionId: 'one', status: 'succeeded' });
});

it('ignores an in-flight response after leaving or switching the task', async () => {
  vi.useFakeTimers();
  let resolveRead: ((result: TodayActionTaskStatusResponse) => void) | undefined;
  const read = vi.fn(() => new Promise<TodayActionTaskStatusResponse>((resolve) => { resolveRead = resolve; }));
  const publish = vi.fn();
  const stop = startTodayTaskPolling('one', read, publish, vi.fn());
  stop();
  resolveRead?.({ actionId: 'one', status: 'executing' });
  await vi.advanceTimersByTimeAsync(10000);
  expect(publish).not.toHaveBeenCalled();
  expect(read).toHaveBeenCalledTimes(1);
});

it('stops on error and allows an explicit new polling session', async () => {
  vi.useFakeTimers();
  const read = vi.fn().mockRejectedValueOnce(new Error('offline'))
    .mockResolvedValue({ actionId: 'one', status: 'succeeded' });
  const fail = vi.fn();
  startTodayTaskPolling('one', read, vi.fn(), fail);
  await vi.advanceTimersByTimeAsync(10000);
  expect(fail).toHaveBeenCalledOnce();
  expect(read).toHaveBeenCalledTimes(1);
  const publish = vi.fn();
  startTodayTaskPolling('one', read, publish, fail);
  await vi.advanceTimersByTimeAsync(0);
  expect(publish).toHaveBeenCalledWith({ actionId: 'one', status: 'succeeded' });
});

it('bounds pending polling to sixty reads and cancels scheduled reads', async () => {
  vi.useFakeTimers();
  const read = vi.fn().mockResolvedValue({ actionId: 'one', status: 'pendingConfirmation' });
  startTodayTaskPolling('one', read, vi.fn(), vi.fn());
  await vi.advanceTimersByTimeAsync(200000);
  expect(read).toHaveBeenCalledTimes(60);
  const stop = startTodayTaskPolling('one', read, vi.fn(), vi.fn());
  await vi.advanceTimersByTimeAsync(0);
  stop();
  await vi.advanceTimersByTimeAsync(10000);
  expect(read).toHaveBeenCalledTimes(61);
});
