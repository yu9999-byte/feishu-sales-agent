import type { TodayActionTaskStatusResponse } from '@shared/api.interface';

function startTodayTaskPolling(
  actionId: string,
  readStatus: (id: string) => Promise<TodayActionTaskStatusResponse>,
  publish: (result: TodayActionTaskStatusResponse) => void,
  fail: (error: Error) => void,
): () => void {
  let active: boolean = true;
  let reads: number = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const read = (): void => {
    reads += 1;
    void readStatus(actionId).then((result: TodayActionTaskStatusResponse) => {
      if (!active) return;
      publish(result);
      if (reads < 60 && ['executing', 'pendingConfirmation'].includes(result.status)) {
        timer = setTimeout(read, 2000);
      }
    }).catch((error: Error) => { if (active) fail(error); });
  };
  read();
  return (): void => { active = false; if (timer) clearTimeout(timer); };
}

export { startTodayTaskPolling };
