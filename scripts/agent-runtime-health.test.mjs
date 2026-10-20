import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { test } from 'node:test';

import { waitForAgentReadiness } from './agent-runtime-health.mjs';

async function withServer(handler, run) {
  const server = createServer(handler);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    await run(server.address().port);
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
}

test('checks the actual readiness endpoint and accepts a valid ready response', async () => {
  await withServer((request, response) => {
    assert.equal(request.url, '/api/health/ready');
    assert.equal(request.method, 'GET');
    response.setHeader('Content-Type', 'application/json');
    response.end(JSON.stringify({
      status: 'ready', database: 'ready', checkedAt: new Date().toISOString(),
    }));
  }, async (port) => {
    assert.deepEqual(await waitForAgentReadiness({ port }), { status: 'ready' });
  });
});

test('does not accept an open port, HTML fallback, live status or an incomplete schema', async () => {
  for (const payload of [
    '<html>App</html>', { status: 'alive' },
    { status: 'ready', database: 'schema_pending', checkedAt: new Date().toISOString() },
  ]) {
    await withServer((_request, response) => response.end(
      typeof payload === 'string' ? payload : JSON.stringify(payload),
    ), async (port) => {
      assert.deepEqual(await waitForAgentReadiness({ port }), { status: 'not_ready' });
    });
  }
});

test('retries an unavailable database until the instance is ready', async () => {
  let calls = 0;
  await withServer((_request, response) => {
    calls += 1;
    response.statusCode = calls === 1 ? 503 : 200;
    response.end(JSON.stringify({
      status: calls === 1 ? 'not_ready' : 'ready',
      database: calls === 1 ? 'unavailable' : 'ready',
      checkedAt: new Date().toISOString(),
    }));
  }, async (port) => {
    assert.deepEqual(await waitForAgentReadiness({
      port, waitMs: 1000, intervalMs: 10,
    }), { status: 'ready' });
    assert.equal(calls, 2);
  });
});

test('bounds hanging HTTP and sanitizes server errors', async () => {
  await withServer(() => undefined, async (port) => {
    assert.deepEqual(await waitForAgentReadiness({
      port, waitMs: 30, requestTimeoutMs: 20, intervalMs: 5,
    }), { status: 'not_ready' });
  });
  await withServer((_request, response) => {
    response.statusCode = 503;
    response.end('password=secret private database url');
  }, async (port) => {
    assert.deepEqual(await waitForAgentReadiness({ port }), { status: 'not_ready' });
  });
});

test('rejects invalid port and time bounds before making a request', async () => {
  for (const input of [{ port: 0 }, { port: 65536 }, { port: 3100, waitMs: -1 }]) {
    await assert.rejects(waitForAgentReadiness(input), /Invalid readiness options/u);
  }
});
