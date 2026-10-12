import assert from 'node:assert/strict';
import test from 'node:test';

import {
  EXIT_CODES,
  RUN_PATH,
  parseConfiguration,
  runProactiveSalesNotifications,
} from './proactive-sales-notification-runner-lib.mjs';

const TOKEN = 'scheduler-test-token';
const environment = (overrides = {}) => ({
  PROACTIVE_SALES_NOTIFICATION_RUN_URL:
    `https://agent.example.com${RUN_PATH}`,
  PROACTIVE_SALES_NOTIFICATION_TRIGGER_TOKEN: TOKEN,
  ...overrides,
});

const result = (status = 'completed') => ({
  mode: 'scheduler-run', status,
  generatedAt: '2026-10-12T01:05:00.000Z',
  summary: {
    tenantCount: 1, memberCount: 1, plannedCount: 1,
    sentCount: status === 'completed' ? 1 : 0,
    skippedCount: 0, failedCount: 0,
  },
  warnings: [],
});

const jsonResponse = (payload, status = 200) => new Response(
  JSON.stringify(payload),
  { status, headers: { 'content-type': 'application/json' } },
);

test('configuration requires a fixed HTTPS endpoint and secret', () => {
  assert.throws(() => parseConfiguration(environment({
    PROACTIVE_SALES_NOTIFICATION_RUN_URL: 'http://agent.example.com/run',
  })));
  assert.throws(() => parseConfiguration(environment({
    PROACTIVE_SALES_NOTIFICATION_TRIGGER_TOKEN: '',
  })));
  assert.throws(() => parseConfiguration(environment({
    PROACTIVE_SALES_NOTIFICATION_RUN_URL:
      'https://agent.example.com/internal/other/run',
  })));
});

test('client sends one bounded POST without exposing the secret', async () => {
  let request;
  const execution = await runProactiveSalesNotifications(environment(), {
    fetchImplementation: async (url, options) => {
      request = { url, options };
      return jsonResponse(result());
    },
    signalFactory: () => new AbortController().signal,
  });
  assert.equal(execution.exitCode, EXIT_CODES.COMPLETED);
  assert.equal(request.options.method, 'POST');
  assert.equal(request.options.redirect, 'error');
  assert.equal(request.options.headers.authorization, `Bearer ${TOKEN}`);
  assert.equal(JSON.stringify(execution.output).includes(TOKEN), false);
});

test('business statuses have distinct exit codes', async () => {
  const cases = [
    ['plan_only', EXIT_CODES.PLAN_ONLY],
    ['disabled', EXIT_CODES.DISABLED],
    ['partial', EXIT_CODES.PARTIAL],
    ['blocked', EXIT_CODES.BLOCKED],
  ];
  for (const [status, exitCode] of cases) {
    const execution = await runProactiveSalesNotifications(environment(), {
      fetchImplementation: async () => jsonResponse(result(status)),
    });
    assert.equal(execution.exitCode, exitCode);
  }
});

test('invalid response and HTTP body fail closed without leaking content', async () => {
  const invalid = await runProactiveSalesNotifications(environment(), {
    fetchImplementation: async () => jsonResponse({ status: 'completed' }),
  });
  assert.equal(invalid.exitCode, EXIT_CODES.INVALID_RESPONSE);
  const http = await runProactiveSalesNotifications(environment(), {
    fetchImplementation: async () => new Response(`secret ${TOKEN}`, {
      status: 401,
    }),
  });
  assert.equal(http.exitCode, EXIT_CODES.HTTP);
  assert.equal(JSON.stringify(http.output).includes(TOKEN), false);
});

test('network failures are sanitized', async () => {
  const execution = await runProactiveSalesNotifications(environment(), {
    fetchImplementation: async () => {
      throw new Error(`private network detail ${TOKEN}`);
    },
  });
  assert.equal(execution.exitCode, EXIT_CODES.NETWORK);
  assert.equal(JSON.stringify(execution.output).includes(TOKEN), false);
});
