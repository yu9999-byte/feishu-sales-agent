const isRateLimited = (error: unknown): boolean => {
  if (typeof error !== 'object' || error === null || !('response' in error)) return false;
  const response: unknown = error.response;
  if (typeof response !== 'object' || response === null || !('data' in response)) return false;
  const data: unknown = response.data;
  return typeof data === 'object' && data !== null && 'code' in data && data.code === 99991400;
};

const retryFeishuRead = async <T extends { code?: number }>(read: () => Promise<T>): Promise<T> => {
  const delays: readonly number[] = [750, 1500, 3000];
  for (let attempt: number = 0; ; attempt += 1) {
    try {
      const result: T = await read();
      if (result.code !== 99991400 || attempt >= delays.length) return result;
    } catch (error: unknown) {
      if (!isRateLimited(error) || attempt >= delays.length) throw error;
    }
    await new Promise<void>((resolve): void => { setTimeout(resolve, delays[attempt]); });
  }
};

export { retryFeishuRead };
