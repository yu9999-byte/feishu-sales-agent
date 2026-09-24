import { describe, expect, it, vi } from 'vitest';

import type { Request, Response } from 'express';
import {
  FeishuWebAuthController,
} from '@server/modules/web-auth/feishu-web-auth.controller';
import {
  FeishuWebAuthError,
  FeishuWebAuthService,
} from '@server/modules/web-auth/feishu-web-auth.service';

const response = (): Response => {
  const result = {
    status: vi.fn(),
    send: vi.fn(),
    redirect: vi.fn(),
    cookie: vi.fn(),
    clearCookie: vi.fn(),
  };
  result.status.mockReturnValue(result);
  return result as unknown as Response;
};

const request = (origin: string | undefined): Request => ({
  headers: {
    origin,
    cookie: 'sales-agent-session=session-secret',
  },
}) as Request;

const setup = (): {
  controller: FeishuWebAuthController;
  auth: FeishuWebAuthService;
} => {
  const auth = {
    publicOrigin: 'https://agent.example.com',
    secureCookie: true,
    revokeSession: vi.fn().mockResolvedValue(undefined),
    completeLogin: vi.fn().mockResolvedValue({
      sessionToken: 'secret',
      redirectPath: '/',
    }),
    startLogin: vi.fn().mockResolvedValue('https://accounts.feishu.cn'),
  } as unknown as FeishuWebAuthService;
  return {
    controller: new FeishuWebAuthController(auth),
    auth,
  };
};

describe('FeishuWebAuthController HTTP boundary', (): void => {
  it('rejects cross-site or missing Origin before revoking a cookie', async (): Promise<void> => {
    const { controller, auth } = setup();
    for (const origin of ['https://evil.example', undefined]) {
      const res: Response = response();
      await controller.logout(request(origin), res);
      expect(res.status).toHaveBeenCalledWith(403);
      expect(auth.revokeSession).not.toHaveBeenCalled();
      expect(res.clearCookie).not.toHaveBeenCalled();
    }
  });

  it('accepts only the configured same origin for logout', async (): Promise<void> => {
    const { controller, auth } = setup();
    const res: Response = response();
    await controller.logout(request('https://agent.example.com'), res);
    expect(auth.revokeSession).toHaveBeenCalledWith('session-secret');
    expect(res.clearCookie).toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(204);
  });

  it('returns a safe callback error without a cookie or an internal exception', async (): Promise<void> => {
    const { controller, auth } = setup();
    vi.mocked(auth.completeLogin).mockRejectedValueOnce(
      new FeishuWebAuthError('INVALID_STATE', 'internal-token-secret'),
    );
    const res: Response = response();
    await controller.callback(
      'code',
      'state',
      undefined,
      request(undefined),
      res,
    );
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.cookie).not.toHaveBeenCalled();
    expect(JSON.stringify(vi.mocked(res.send).mock.calls)).not.toContain(
      'internal-token-secret',
    );
  });

  it('uses Secure for the public HTTPS origin even outside production', async (): Promise<void> => {
    const { controller } = setup();
    const res: Response = response();
    await controller.callback(
      'code',
      'state',
      undefined,
      request(undefined),
      res,
    );
    expect(res.cookie).toHaveBeenCalledWith(
      'sales-agent-session',
      'secret',
      expect.objectContaining({ httpOnly: true, secure: true }),
    );
  });
});
