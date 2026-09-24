export class FeishuApiError extends Error {
  constructor(
    readonly code: string,
    operation: string,
    upstreamMessage?: string,
  ) {
    super(
      upstreamMessage
        ? `${operation} failed: ${upstreamMessage}`
        : `${operation} failed`,
    );
    this.name = FeishuApiError.name;
  }
}

const assertFeishuSuccess = (
  code: number | undefined,
  message: string | undefined,
  operation: string,
): void => {
  if (code !== undefined && code !== 0) {
    throw new FeishuApiError(String(code), operation, message);
  }
};

const requireFeishuId = (
  value: string | undefined,
  operation: string,
): string => {
  if (!value) {
    throw new FeishuApiError('EMPTY_RESULT', operation);
  }
  return value;
};

export { assertFeishuSuccess, requireFeishuId };
