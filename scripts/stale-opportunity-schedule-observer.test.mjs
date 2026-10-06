import assert from 'node:assert/strict';
import test from 'node:test';

import {
  EXIT_CODES,
  OBSERVATION_PATH,
  readConfiguration,
  runScheduleObservation,
  validateObservation,
} from './stale-opportunity-schedule-observer-lib.mjs';

const OBSERVER_TOKEN = 'test-observer-token-placeholder';

function environment(overrides = {}) {
  return {
    STALE_OPPORTUNITY_REMINDER_SCHEDULE_OBSERVATION_URL:
      `https://agent.example.com${OBSERVATION_PATH}`,
    STALE_OPPORTUNITY_REMINDER_SCHEDULE_OBSERVATION_TOKEN: OBSERVER_TOKEN,
    ...overrides,
  };
}

function observation(overrides = {}) {
  const base = {
    mode: 'read-only-observation',
    traceId: 'trace-schedule-observer-test',
    status: 'blocked',
    observedAt: '2026-10-06T08:00:00.000Z',
    blockers: ['history_governance_incomplete'],
    summary: {
      executionReadinessStatus: 'blocked',
      blockerCount: 1,
      warningCount: 0,
      historyGovernanceStatus: 'incomplete',
      senderEvidenceStatus: 'complete',
      ledgerStatus: 'clear',
      candidateProbeStatus: 'complete',
      candidateCount: 0,
      matchingCandidateCount: 0,
    },
    auditRecorded: true,
    warnings: [],
  };
  return {
    ...base,
    ...overrides,
    summary: {
      ...base.summary,
      ...(overrides.summary ?? {}),
    },
  };
}

function jsonResponse(payload, options = {}) {
  return new Response(JSON.stringify(payload), {
    status: options.status ?? 200,
    headers: {
      'content-type': options.contentType ?? 'application/json; charset=utf-8',
    },
  });
}

test('configuration requires the fixed observation endpoint and token', () => {
  assert.throws(
    () => readConfiguration(environment({
      STALE_OPPORTUNITY_REMINDER_SCHEDULE_OBSERVATION_URL: '',
    })),
    /SCHEDULE_OBSERVATION_URL/u,
  );
  assert.throws(
    () => readConfiguration(environment({
      STALE_OPPORTUNITY_REMINDER_SCHEDULE_OBSERVATION_TOKEN: '',
    })),
    /SCHEDULE_OBSERVATION_TOKEN/u,
  );
  assert.throws(
    () => readConfiguration(environment({
      STALE_OPPORTUNITY_REMINDER_SCHEDULE_OBSERVATION_URL:
        'https://agent.example.com/internal/stale-opportunity-reminder/execute',
    })),
    /schedule-observation/u,
  );
});

test('configuration rejects credential URLs, query strings and remote HTTP', () => {
  const invalidUrls = [
    ['https://user', `pass@agent.example.com${OBSERVATION_PATH}`].join(':'),
    `https://agent.example.com${OBSERVATION_PATH}?token=unsafe`,
    `http://agent.example.com${OBSERVATION_PATH}`,
  ];

  for (const url of invalidUrls) {
    assert.throws(
      () => readConfiguration(environment({
        STALE_OPPORTUNITY_REMINDER_SCHEDULE_OBSERVATION_URL: url,
      })),
    );
  }
});

test('configuration accepts loopback HTTP and bounded timeout', () => {
  const config = readConfiguration(environment({
    STALE_OPPORTUNITY_REMINDER_SCHEDULE_OBSERVATION_URL:
      `http://127.0.0.1:3100${OBSERVATION_PATH}/`,
    STALE_OPPORTUNITY_REMINDER_SCHEDULE_OBSERVATION_TIMEOUT_MS: '2500',
  }));

  assert.equal(config.endpoint, `http://127.0.0.1:3100${OBSERVATION_PATH}`);
  assert.equal(config.timeoutMs, 2500);
  assert.throws(
    () => readConfiguration(environment({
      STALE_OPPORTUNITY_REMINDER_SCHEDULE_OBSERVATION_TIMEOUT_MS: '999',
    })),
    /1000/u,
  );
});

test('client sends one POST with only the observer bearer credential', async () => {
  let request;
  const result = await runScheduleObservation(environment(), {
    fetchImplementation: async (url, options) => {
      request = { url, options };
      return jsonResponse(observation());
    },
    signalFactory: () => new AbortController().signal,
  });

  assert.equal(result.exitCode, EXIT_CODES.BLOCKED);
  assert.equal(request.url, `https://agent.example.com${OBSERVATION_PATH}`);
  assert.equal(request.options.method, 'POST');
  assert.equal(request.options.redirect, 'error');
  assert.equal(request.options.headers.authorization, `Bearer ${OBSERVER_TOKEN}`);
  assert.equal('body' in request.options, false);
  assert.equal(JSON.stringify(result.output).includes(OBSERVER_TOKEN), false);
});

test('ready, blocked, incomplete and unavailable have distinct exit codes', async () => {
  const cases = [
    {
      payload: observation({
        status: 'ready',
        blockers: [],
        summary: {
          executionReadinessStatus: 'ready_for_manual_activation',
          blockerCount: 0,
        },
      }),
      exitCode: EXIT_CODES.READY,
    },
    { payload: observation(), exitCode: EXIT_CODES.BLOCKED },
    {
      payload: observation({ status: 'incomplete', auditRecorded: false }),
      exitCode: EXIT_CODES.INCOMPLETE,
    },
    {
      payload: observation({
        status: 'unavailable',
        blockers: [],
        summary: {
          executionReadinessStatus: 'unavailable',
          blockerCount: 0,
        },
      }),
      exitCode: EXIT_CODES.UNAVAILABLE,
    },
  ];

  for (const entry of cases) {
    const result = await runScheduleObservation(environment(), {
      fetchImplementation: async () => jsonResponse(entry.payload),
    });
    assert.equal(result.exitCode, entry.exitCode);
    assert.equal(result.output.status, entry.payload.status);
  }
});

test('configuration failures are machine-readable and never expose the token', async () => {
  const result = await runScheduleObservation(environment({
    STALE_OPPORTUNITY_REMINDER_SCHEDULE_OBSERVATION_URL: 'not-a-url',
  }));

  assert.equal(result.exitCode, EXIT_CODES.CONFIGURATION);
  assert.equal(result.output.category, 'configuration');
  assert.equal(JSON.stringify(result.output).includes(OBSERVER_TOKEN), false);
});

test('timeout and network failures have distinct exit codes', async () => {
  const timeout = await runScheduleObservation(environment(), {
    fetchImplementation: async () => {
      const error = new Error('request timed out with private diagnostics');
      error.name = 'TimeoutError';
      throw error;
    },
  });
  const network = await runScheduleObservation(environment(), {
    fetchImplementation: async () => {
      throw new Error(`connect failed: Bearer ${OBSERVER_TOKEN}`);
    },
  });

  assert.equal(timeout.exitCode, EXIT_CODES.TIMEOUT);
  assert.equal(timeout.output.category, 'timeout');
  assert.equal(network.exitCode, EXIT_CODES.NETWORK);
  assert.equal(network.output.category, 'network');
  assert.equal(JSON.stringify(network.output).includes(OBSERVER_TOKEN), false);
});

test('HTTP failures do not echo the response body', async () => {
  const result = await runScheduleObservation(environment(), {
    fetchImplementation: async () => new Response(
      `private upstream body ${OBSERVER_TOKEN}`,
      { status: 401 },
    ),
  });

  assert.equal(result.exitCode, EXIT_CODES.HTTP);
  assert.equal(result.output.category, 'http');
  assert.equal(JSON.stringify(result.output).includes(OBSERVER_TOKEN), false);
});

test('invalid content type, JSON and oversized bodies fail closed', async () => {
  const responses = [
    new Response('{}', {
      status: 200,
      headers: { 'content-type': 'text/html' },
    }),
    new Response('{not-json', {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }),
    new Response(`"${'x'.repeat(70 * 1024)}"`, {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }),
  ];

  for (const response of responses) {
    const result = await runScheduleObservation(environment(), {
      fetchImplementation: async () => response,
    });
    assert.equal(result.exitCode, EXIT_CODES.INVALID_RESPONSE);
    assert.equal(result.output.category, 'invalid_response');
  }
});

test('contract validation rejects inconsistent counts and readiness states', () => {
  assert.throws(() => validateObservation(observation({
    summary: { blockerCount: 0 },
  })));
  assert.throws(() => validateObservation(observation({
    status: 'ready',
    blockers: [],
    summary: {
      executionReadinessStatus: 'blocked',
      blockerCount: 0,
    },
  })));
  assert.throws(() => validateObservation(observation({
    status: 'incomplete',
    auditRecorded: true,
  })));
});
