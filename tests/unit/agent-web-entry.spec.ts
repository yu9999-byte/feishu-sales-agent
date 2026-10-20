import { resolve } from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

import { createServer, type ViteDevServer } from 'vite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

let server: ViteDevServer | undefined;
let origin: string;

beforeAll(async (): Promise<void> => {
  server = await createServer({
    configFile: resolve(process.cwd(), 'vite.agent.config.ts'),
    envDir: false,
    logLevel: 'silent',
    optimizeDeps: { noDiscovery: true, include: [] },
    server: {
      host: '127.0.0.1',
      port: 0,
      strictPort: false,
      open: false,
      watch: null,
      preTransformRequests: false,
    },
    plugins: [{
      name: 'entry-request-observer',
      configureServer(viteServer: ViteDevServer): void {
        viteServer.middlewares.use((
          request: IncomingMessage, response: ServerResponse, next: () => void,
        ): void => {
          if (request.headers['x-entry-probe'] !== 'passthrough') {
            next();
            return;
          }
          response.setHeader('X-Observed-Url', request.url ?? '');
          response.statusCode = 204;
          response.end();
        });
      },
    }],
  });
  await server.listen();
  const address: AddressInfo | string | null | undefined = server.httpServer?.address();
  if (!address || typeof address === 'string') {
    throw new Error('Vite did not bind an ephemeral HTTP port');
  }
  origin = `http://127.0.0.1:${address.port}`;
}, 30_000);

afterAll(async (): Promise<void> => {
  await server?.close();
});

describe('independent Agent Web HTML entry', { timeout: 15_000 }, (): void => {
  it.each([
    '/',
    '/?customerName=%E7%A4%BA%E4%BE%8B&purpose=review',
    '/preparations/result-id',
    '/preparations/result-id?from=chat',
    '/agent.html',
  ])('serves the Agent entry for direct navigation to %s', async (path: string): Promise<void> => {
    const response: Response = await fetch(`${origin}${path}`, {
      headers: { Accept: 'text/html' },
      signal: AbortSignal.timeout(10_000),
    });
    const html: string = await response.text();
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/html');
    expect(html).toContain('src="/src/agent-web/main.tsx"');
    expect(html).not.toContain('__platform__');
    expect(html).not.toContain('/client/src/index.tsx');
  });

  it.each(['GET', 'HEAD'])('preserves the query during %s HTML navigation', async (method: string): Promise<void> => {
    const response: Response = await fetch(`${origin}/preparations/result-id?from=chat&value=a%2Bb`, {
      method,
      headers: { Accept: 'text/html', 'X-Entry-Probe': 'passthrough' },
      signal: AbortSignal.timeout(10_000),
    });
    const observed: URL = new URL(response.headers.get('x-observed-url') ?? '', origin);
    expect(observed.search).toBe('?from=chat&value=a%2Bb');
  });

  it.each([
    ['/api/results', 'GET', 'text/html'],
    ['/openapi/results', 'GET', 'text/html'],
    ['/__innerapi__/identity', 'GET', 'text/html'],
    ['/app/example/__runtime__/identity', 'GET', 'text/html'],
    ['/@vite/client', 'GET', 'text/html'],
    ['/src/agent-web/main.tsx', 'GET', 'text/html'],
    ['/assets/missing.css', 'GET', 'text/html'],
    ['/preparations/result-id', 'POST', 'text/html'],
    ['/preparations/result-id', 'GET', 'application/json'],
  ])('leaves %s (%s, %s) untouched', async (
    path: string, method: string, accept: string,
  ): Promise<void> => {
    const response: Response = await fetch(`${origin}${path}`, {
      method,
      headers: { Accept: accept, 'X-Entry-Probe': 'passthrough' },
      signal: AbortSignal.timeout(10_000),
    });
    expect(response.status).toBe(204);
    expect(response.headers.get('x-observed-url')).toBe(path);
  });
});
