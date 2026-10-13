type FeishuOAuthFailureStage =
  | 'token_exchange'
  | 'user_info'
  | 'grant_validation'
  | 'member_resolution'
  | 'credential_persist'
  | 'session_persist';

interface FeishuOAuthFailureDiagnostic {
  event: 'oauth_callback_failed';
  stage: FeishuOAuthFailureStage;
  errorType: string;
  upstreamStatus?: number;
  upstreamCode?: number;
}

interface FeishuOAuthCallbackErrorInput {
  stage: FeishuOAuthFailureStage;
  errorType: string;
  upstreamStatus?: number;
  upstreamCode?: number;
}

const SAFE_ERROR_TYPE: RegExp = /^[A-Za-z][A-Za-z0-9_.-]{0,79}$/u;

const readProperty = (value: unknown, key: string): unknown => {
  if (typeof value !== 'object' || value === null || !(key in value)) {
    return undefined;
  }
  return Reflect.get(value, key);
};

const readFiniteNumber = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value)
    ? value
    : undefined;

const readErrorType = (error: unknown): string => {
  const name: unknown = readProperty(error, 'name');
  return typeof name === 'string' && SAFE_ERROR_TYPE.test(name)
    ? name
    : 'UnknownError';
};

class FeishuOAuthCallbackError extends Error {
  readonly stage: FeishuOAuthFailureStage;
  readonly errorType: string;
  readonly upstreamStatus?: number;
  readonly upstreamCode?: number;

  constructor(input: FeishuOAuthCallbackErrorInput) {
    super('Feishu OAuth callback failed');
    this.name = 'FeishuOAuthCallbackError';
    this.stage = input.stage;
    this.errorType = SAFE_ERROR_TYPE.test(input.errorType)
      ? input.errorType
      : 'UnknownError';
    this.upstreamStatus = input.upstreamStatus;
    this.upstreamCode = input.upstreamCode;
  }

  toDiagnostic(): FeishuOAuthFailureDiagnostic {
    return {
      event: 'oauth_callback_failed',
      stage: this.stage,
      errorType: this.errorType,
      ...(this.upstreamStatus === undefined
        ? {}
        : { upstreamStatus: this.upstreamStatus }),
      ...(this.upstreamCode === undefined
        ? {}
        : { upstreamCode: this.upstreamCode }),
    };
  }
}

const toFeishuOAuthCallbackError = (
  stage: FeishuOAuthFailureStage,
  error: unknown,
): FeishuOAuthCallbackError => {
  if (error instanceof FeishuOAuthCallbackError) {
    return error;
  }
  const response: unknown = readProperty(error, 'response');
  const responseData: unknown = readProperty(response, 'data');
  return new FeishuOAuthCallbackError({
    stage,
    errorType: readErrorType(error),
    upstreamStatus:
      readFiniteNumber(readProperty(error, 'statusCode')) ??
      readFiniteNumber(readProperty(response, 'status')),
    upstreamCode:
      readFiniteNumber(readProperty(error, 'code')) ??
      readFiniteNumber(readProperty(responseData, 'code')),
  });
};

export {
  FeishuOAuthCallbackError,
  toFeishuOAuthCallbackError,
};
export type {
  FeishuOAuthFailureDiagnostic,
  FeishuOAuthFailureStage,
};
