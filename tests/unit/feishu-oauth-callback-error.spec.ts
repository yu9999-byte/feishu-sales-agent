import { describe, expect, it } from 'vitest';

import {
  FeishuOAuthCallbackError,
  toFeishuOAuthCallbackError,
} from '@server/modules/web-auth/feishu-oauth-callback.error';

describe('FeishuOAuthCallbackError', (): void => {
  it('extracts only safe numeric provider diagnostics', (): void => {
    const providerFailure: object = {
      name: 'AccessTokenError',
      message: 'secret-code secret-state secret-access-token',
      statusCode: 400,
      code: 20029,
      errorDescription: 'contains-secret-client-secret',
    };

    const failure: FeishuOAuthCallbackError =
      toFeishuOAuthCallbackError('token_exchange', providerFailure);

    expect(failure).toMatchObject({
      stage: 'token_exchange',
      errorType: 'AccessTokenError',
      upstreamStatus: 400,
      upstreamCode: 20029,
    });
    expect(JSON.stringify(failure.toDiagnostic())).not.toContain('secret');
    expect(failure.message).not.toContain('secret');
  });

  it('reads nested HTTP response codes without retaining the response', (): void => {
    const providerFailure: object = {
      name: 'AxiosError',
      config: { data: 'client_secret=must-not-survive' },
      response: {
        status: 403,
        data: {
          code: 99991663,
          msg: 'access_token=must-not-survive',
        },
      },
    };

    const failure: FeishuOAuthCallbackError =
      toFeishuOAuthCallbackError('user_info', providerFailure);

    expect(failure.toDiagnostic()).toEqual({
      event: 'oauth_callback_failed',
      stage: 'user_info',
      errorType: 'AxiosError',
      upstreamStatus: 403,
      upstreamCode: 99991663,
    });
    expect(Object.hasOwn(failure, 'cause')).toBe(false);
  });

  it('falls back to a fixed error type for unsafe names', (): void => {
    const failure: FeishuOAuthCallbackError =
      toFeishuOAuthCallbackError(
        'credential_persist',
        { name: 'token=secret value' },
      );

    expect(failure.toDiagnostic()).toEqual({
      event: 'oauth_callback_failed',
      stage: 'credential_persist',
      errorType: 'UnknownError',
    });
  });
});
