import { describe, expect, it, vi } from 'vitest';

import {
  createAgentWebSpaFallback,
  shouldServeAgentWebSpa,
} from '@server/config/agent-web-spa-fallback';

interface NavigationRequest {
  method: string;
  path: string;
  accept?: string;
}

const request = (
  path: string,
  options: Partial<NavigationRequest> = {},
): NavigationRequest => ({
  method: options.method ?? 'GET',
  path,
  accept: options.accept ?? 'text/html,application/xhtml+xml',
});

describe('Agent Web SPA fallback', (): void => {
  it('serves the SPA for browser page navigation', (): void => {
    expect(shouldServeAgentWebSpa(request('/ui-uat-404'))).toBe(true);
    expect(shouldServeAgentWebSpa(request('/customers/customer-a/briefing')))
      .toBe(true);
  });

  it.each([
    '/api',
    '/api/platform/unknown',
    '/webhooks',
    '/webhooks/feishu/unknown',
    '/internal',
    '/internal/unknown',
  ])('preserves server handling for %s', (path: string): void => {
    expect(shouldServeAgentWebSpa(request(path))).toBe(false);
  });

  it('preserves missing static resource errors', (): void => {
    expect(shouldServeAgentWebSpa(request('/assets/missing.js'))).toBe(false);
    expect(shouldServeAgentWebSpa(request('/styles/missing.css'))).toBe(false);
  });

  it('rejects non-GET and non-HTML requests', (): void => {
    expect(shouldServeAgentWebSpa(request('/unknown', { method: 'POST' })))
      .toBe(false);
    expect(shouldServeAgentWebSpa(request('/unknown', {
      accept: 'application/json',
    }))).toBe(false);
  });

  it('sends the SPA file only when the request matches', (): void => {
    const middleware = createAgentWebSpaFallback('/absolute/agent.html');
    const sendFile = vi.fn();
    const next = vi.fn();

    middleware(
      {
        method: 'GET',
        path: '/ui-uat-404',
        headers: { accept: 'text/html' },
      } as never,
      { sendFile } as never,
      next,
    );

    expect(sendFile).toHaveBeenCalledWith(
      '/absolute/agent.html',
      expect.any(Function),
    );
    expect(next).not.toHaveBeenCalled();
  });

  it('passes server requests to Nest', (): void => {
    const middleware = createAgentWebSpaFallback('/absolute/agent.html');
    const sendFile = vi.fn();
    const next = vi.fn();

    middleware(
      {
        method: 'GET',
        path: '/api/unknown',
        headers: { accept: 'text/html' },
      } as never,
      { sendFile } as never,
      next,
    );

    expect(sendFile).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledOnce();
  });
});
