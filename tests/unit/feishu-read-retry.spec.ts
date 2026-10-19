import { afterEach, expect, it, vi } from 'vitest';
import { retryFeishuRead } from '../../server/modules/integrations/task/feishu-read-retry';

afterEach((): void => { vi.useRealTimers(); });

it('backs off only a confirmed read rate limit and preserves the response', async (): Promise<void> => {
  vi.useFakeTimers();
  const read = vi.fn().mockRejectedValueOnce({ response: { data: { code: 99991400 } } })
    .mockResolvedValue({ code: 0, value: 'original response' });
  const pending = retryFeishuRead(read);
  await vi.advanceTimersByTimeAsync(749);
  expect(read).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(1);
  expect(await pending).toEqual({ code: 0, value: 'original response' });
});

it('does not retry permission or transport failures', async (): Promise<void> => {
  const failure = { response: { data: { code: 99991672 } } };
  const read = vi.fn().mockRejectedValue(failure);
  await expect(retryFeishuRead(read)).rejects.toBe(failure);
  expect(read).toHaveBeenCalledTimes(1);
});

it('stops after three retries and preserves the last failure', async (): Promise<void> => {
  vi.useFakeTimers();
  const failure = { response: { data: { code: 99991400 } } };
  const read = vi.fn().mockRejectedValue(failure);
  const checked = expect(retryFeishuRead(read)).rejects.toBe(failure);
  await vi.runAllTimersAsync();
  await checked;
  expect(read).toHaveBeenCalledTimes(4);
});

it('also handles SDK responses carrying an explicit rate code', async (): Promise<void> => {
  vi.useFakeTimers();
  const read = vi.fn().mockResolvedValueOnce({ code: 99991400 }).mockResolvedValue({ code: 0 });
  const pending = retryFeishuRead(read);
  await vi.runAllTimersAsync();
  expect(await pending).toEqual({ code: 0 });
  expect(read).toHaveBeenCalledTimes(2);
});
