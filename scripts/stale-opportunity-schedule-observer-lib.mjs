const OBSERVATION_PATH =
  '/internal/stale-opportunity-reminder/schedule-observation';
const URL_ENVIRONMENT_VARIABLE =
  'STALE_OPPORTUNITY_REMINDER_SCHEDULE_OBSERVATION_URL';
const TOKEN_ENVIRONMENT_VARIABLE =
  'STALE_OPPORTUNITY_REMINDER_SCHEDULE_OBSERVATION_TOKEN';
const TIMEOUT_ENVIRONMENT_VARIABLE =
  'STALE_OPPORTUNITY_REMINDER_SCHEDULE_OBSERVATION_TIMEOUT_MS';
const DEFAULT_TIMEOUT_MS = 10_000;
const MINIMUM_TIMEOUT_MS = 1_000;
const MAXIMUM_TIMEOUT_MS = 60_000;
const MAXIMUM_RESPONSE_BYTES = 64 * 1024;

const EXIT_CODES = Object.freeze({
  READY: 0,
  BLOCKED: 2,
  INCOMPLETE: 3,
  UNAVAILABLE: 4,
  CONFIGURATION: 10,
  TIMEOUT: 11,
  NETWORK: 12,
  HTTP: 13,
  INVALID_RESPONSE: 14,
});

const OBSERVATION_STATUSES = new Set([
  'blocked',
  'ready',
  'unavailable',
  'incomplete',
]);
const READINESS_STATUSES = new Set([
  'blocked',
  'ready_for_manual_activation',
  'unavailable',
]);
const EVIDENCE_STATUSES = new Set([
  'complete',
  'incomplete',
  'unavailable',
  'not_checked',
]);
const LEDGER_STATUSES = new Set([
  'clear',
  'uncertain',
  'unavailable',
  'not_checked',
]);
const CANDIDATE_PROBE_STATUSES = new Set([
  'complete',
  'incomplete',
  'disabled',
  'not_checked',
]);
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

class ScheduleObservationClientError extends Error {
  constructor(category, exitCode, message) {
    super(message);
    this.name = 'ScheduleObservationClientError';
    this.category = category;
    this.exitCode = exitCode;
  }
}

function configurationError(message) {
  return new ScheduleObservationClientError(
    'configuration',
    EXIT_CODES.CONFIGURATION,
    message,
  );
}

function invalidResponseError() {
  return new ScheduleObservationClientError(
    'invalid_response',
    EXIT_CODES.INVALID_RESPONSE,
    '观察入口返回了不符合契约的响应',
  );
}

function parseTimeout(rawValue) {
  if (rawValue === undefined || String(rawValue).trim() === '') {
    return DEFAULT_TIMEOUT_MS;
  }

  const normalized = String(rawValue).trim();
  if (!/^\d+$/u.test(normalized)) {
    throw configurationError(
      `${TIMEOUT_ENVIRONMENT_VARIABLE} 必须是整数毫秒`,
    );
  }
  const timeoutMs = Number(normalized);
  if (
    !Number.isSafeInteger(timeoutMs)
    || timeoutMs < MINIMUM_TIMEOUT_MS
    || timeoutMs > MAXIMUM_TIMEOUT_MS
  ) {
    throw configurationError(
      `${TIMEOUT_ENVIRONMENT_VARIABLE} 必须介于 1000 和 60000 之间`,
    );
  }
  return timeoutMs;
}

function parseEndpoint(rawValue) {
  const normalized = String(rawValue ?? '').trim();
  if (!normalized) {
    throw configurationError(`缺少 ${URL_ENVIRONMENT_VARIABLE}`);
  }

  let endpoint;
  try {
    endpoint = new URL(normalized);
  } catch {
    throw configurationError(`${URL_ENVIRONMENT_VARIABLE} 不是有效 URL`);
  }

  const isSecure = endpoint.protocol === 'https:';
  const isLoopbackHttp =
    endpoint.protocol === 'http:' && LOOPBACK_HOSTS.has(endpoint.hostname);
  if (!isSecure && !isLoopbackHttp) {
    throw configurationError('观察入口必须使用 HTTPS；仅本机允许 HTTP');
  }
  if (endpoint.username || endpoint.password) {
    throw configurationError('观察入口 URL 不得包含用户名或密码');
  }
  if (endpoint.search || endpoint.hash) {
    throw configurationError('观察入口 URL 不得包含查询参数或片段');
  }

  const normalizedPath = endpoint.pathname.replace(/\/$/u, '');
  if (!normalizedPath.endsWith(OBSERVATION_PATH)) {
    throw configurationError(
      `观察入口 URL 必须以 ${OBSERVATION_PATH} 结尾`,
    );
  }
  endpoint.pathname = normalizedPath;
  return endpoint.toString();
}

function parseToken(rawValue) {
  const token = String(rawValue ?? '').trim();
  if (!token) {
    throw configurationError(`缺少 ${TOKEN_ENVIRONMENT_VARIABLE}`);
  }
  if (/\s/u.test(token) || /\p{Cc}/u.test(token)) {
    throw configurationError(`${TOKEN_ENVIRONMENT_VARIABLE} 格式无效`);
  }
  return token;
}

function readConfiguration(environment) {
  return {
    endpoint: parseEndpoint(environment[URL_ENVIRONMENT_VARIABLE]),
    timeoutMs: parseTimeout(environment[TIMEOUT_ENVIRONMENT_VARIABLE]),
    token: parseToken(environment[TOKEN_ENVIRONMENT_VARIABLE]),
  };
}

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonNegativeInteger(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

function readStringList(value, maximumLength, maximumItemLength) {
  if (!Array.isArray(value) || value.length > maximumLength) {
    throw invalidResponseError();
  }
  if (
    value.some(
      (item) =>
        typeof item !== 'string'
        || item.length === 0
        || item.length > maximumItemLength,
    )
  ) {
    throw invalidResponseError();
  }
  return [...value];
}

function readEnum(value, allowedValues) {
  if (typeof value !== 'string' || !allowedValues.has(value)) {
    throw invalidResponseError();
  }
  return value;
}

function readSummary(value) {
  if (!isPlainObject(value)) {
    throw invalidResponseError();
  }
  const summary = {
    executionReadinessStatus: readEnum(
      value.executionReadinessStatus,
      READINESS_STATUSES,
    ),
    blockerCount: value.blockerCount,
    warningCount: value.warningCount,
    historyGovernanceStatus: readEnum(
      value.historyGovernanceStatus,
      EVIDENCE_STATUSES,
    ),
    senderEvidenceStatus: readEnum(
      value.senderEvidenceStatus,
      EVIDENCE_STATUSES,
    ),
    ledgerStatus: readEnum(value.ledgerStatus, LEDGER_STATUSES),
    candidateProbeStatus: readEnum(
      value.candidateProbeStatus,
      CANDIDATE_PROBE_STATUSES,
    ),
    candidateCount: value.candidateCount,
    matchingCandidateCount: value.matchingCandidateCount,
  };
  const counts = [
    summary.blockerCount,
    summary.warningCount,
    summary.candidateCount,
    summary.matchingCandidateCount,
  ];
  if (
    counts.some((count) => !isNonNegativeInteger(count))
    || summary.matchingCandidateCount > summary.candidateCount
  ) {
    throw invalidResponseError();
  }
  return summary;
}

function validateStatusConsistency(observation) {
  const { status, summary, blockers, warnings, auditRecorded } = observation;
  if (
    summary.blockerCount !== blockers.length
    || summary.warningCount !== warnings.length
  ) {
    throw invalidResponseError();
  }
  if (
    status === 'ready'
    && (
      summary.executionReadinessStatus !== 'ready_for_manual_activation'
      || blockers.length !== 0
      || !auditRecorded
    )
  ) {
    throw invalidResponseError();
  }
  if (
    status === 'blocked'
    && (summary.executionReadinessStatus !== 'blocked' || !auditRecorded)
  ) {
    throw invalidResponseError();
  }
  if (status === 'incomplete' && auditRecorded) {
    throw invalidResponseError();
  }
  if (
    status === 'unavailable'
    && summary.executionReadinessStatus !== 'unavailable'
  ) {
    throw invalidResponseError();
  }
}

function validateObservation(value) {
  if (!isPlainObject(value) || value.mode !== 'read-only-observation') {
    throw invalidResponseError();
  }
  if (
    typeof value.traceId !== 'string'
    || value.traceId.length === 0
    || value.traceId.length > 128
    || typeof value.observedAt !== 'string'
    || !Number.isFinite(Date.parse(value.observedAt))
    || typeof value.auditRecorded !== 'boolean'
  ) {
    throw invalidResponseError();
  }

  const observation = {
    mode: value.mode,
    traceId: value.traceId,
    status: readEnum(value.status, OBSERVATION_STATUSES),
    observedAt: value.observedAt,
    blockers: readStringList(value.blockers, 100, 128),
    summary: readSummary(value.summary),
    auditRecorded: value.auditRecorded,
    warnings: readStringList(value.warnings, 100, 256),
  };
  validateStatusConsistency(observation);
  return observation;
}

async function readBoundedBody(response) {
  const advertisedLength = Number(response.headers.get('content-length'));
  if (
    Number.isFinite(advertisedLength)
    && advertisedLength > MAXIMUM_RESPONSE_BYTES
  ) {
    throw invalidResponseError();
  }
  if (!response.body) {
    return '';
  }

  const reader = response.body.getReader();
  const chunks = [];
  let totalBytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    totalBytes += value.byteLength;
    if (totalBytes > MAXIMUM_RESPONSE_BYTES) {
      await reader.cancel();
      throw invalidResponseError();
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks, totalBytes).toString('utf8');
}

async function parseResponse(response) {
  const contentType = response.headers.get('content-type') ?? '';
  if (!contentType.toLowerCase().includes('application/json')) {
    throw invalidResponseError();
  }
  const body = await readBoundedBody(response);

  let value;
  try {
    value = JSON.parse(body);
  } catch {
    throw invalidResponseError();
  }
  return validateObservation(value);
}

function isTimeoutError(error, signal) {
  return signal.aborted
    || error?.name === 'AbortError'
    || error?.name === 'TimeoutError';
}

async function requestObservation(configuration, dependencies) {
  const fetchImplementation = dependencies.fetchImplementation
    ?? globalThis.fetch;
  const signalFactory = dependencies.signalFactory
    ?? ((timeoutMs) => AbortSignal.timeout(timeoutMs));
  const signal = signalFactory(configuration.timeoutMs);
  let response;

  try {
    response = await fetchImplementation(configuration.endpoint, {
      method: 'POST',
      headers: {
        accept: 'application/json',
        authorization: `Bearer ${configuration.token}`,
      },
      redirect: 'error',
      signal,
    });
  } catch (error) {
    if (isTimeoutError(error, signal)) {
      throw new ScheduleObservationClientError(
        'timeout',
        EXIT_CODES.TIMEOUT,
        '观察入口调用超时',
      );
    }
    throw new ScheduleObservationClientError(
      'network',
      EXIT_CODES.NETWORK,
      '观察入口网络调用失败',
    );
  }

  if (!response.ok) {
    throw new ScheduleObservationClientError(
      'http',
      EXIT_CODES.HTTP,
      `观察入口返回 HTTP ${String(response.status)}`,
    );
  }
  return parseResponse(response);
}

function exitCodeForStatus(status) {
  switch (status) {
    case 'ready':
      return EXIT_CODES.READY;
    case 'blocked':
      return EXIT_CODES.BLOCKED;
    case 'incomplete':
      return EXIT_CODES.INCOMPLETE;
    case 'unavailable':
      return EXIT_CODES.UNAVAILABLE;
    default:
      return EXIT_CODES.INVALID_RESPONSE;
  }
}

function successOutput(observation, exitCode) {
  return {
    operation: 'stale-opportunity-schedule-observation',
    ok: observation.status === 'ready',
    status: observation.status,
    exitCode,
    observedAt: observation.observedAt,
    traceId: observation.traceId,
    auditRecorded: observation.auditRecorded,
    blockers: observation.blockers,
    summary: observation.summary,
    warnings: observation.warnings,
  };
}

function errorOutput(error) {
  return {
    operation: 'stale-opportunity-schedule-observation',
    ok: false,
    status: 'error',
    category: error.category,
    exitCode: error.exitCode,
    message: error.message,
  };
}

async function runScheduleObservation(environment, dependencies = {}) {
  try {
    const configuration = readConfiguration(environment);
    const observation = await requestObservation(configuration, dependencies);
    const exitCode = exitCodeForStatus(observation.status);
    return {
      exitCode,
      output: successOutput(observation, exitCode),
    };
  } catch (error) {
    const normalized = error instanceof ScheduleObservationClientError
      ? error
      : new ScheduleObservationClientError(
        'network',
        EXIT_CODES.NETWORK,
        '观察入口调用失败',
      );
    return {
      exitCode: normalized.exitCode,
      output: errorOutput(normalized),
    };
  }
}

export {
  EXIT_CODES,
  OBSERVATION_PATH,
  ScheduleObservationClientError,
  readConfiguration,
  runScheduleObservation,
  validateObservation,
};
