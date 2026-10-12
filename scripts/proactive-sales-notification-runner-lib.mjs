const RUN_PATH = '/internal/proactive-sales-notifications/run';
const URL_VARIABLE = 'PROACTIVE_SALES_NOTIFICATION_RUN_URL';
const TOKEN_VARIABLE = 'PROACTIVE_SALES_NOTIFICATION_TRIGGER_TOKEN';
const TIMEOUT_VARIABLE = 'PROACTIVE_SALES_NOTIFICATION_TIMEOUT_MS';
const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_RESPONSE_BYTES = 64 * 1024;
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

const EXIT_CODES = Object.freeze({
  COMPLETED: 0,
  PLAN_ONLY: 2,
  DISABLED: 3,
  PARTIAL: 4,
  BLOCKED: 5,
  CONFIGURATION: 10,
  TIMEOUT: 11,
  NETWORK: 12,
  HTTP: 13,
  INVALID_RESPONSE: 14,
});

const STATUSES = new Set([
  'disabled', 'plan_only', 'completed', 'partial', 'blocked',
]);

class ProactiveNotificationRunnerError extends Error {
  constructor(category, exitCode, message) {
    super(message);
    this.name = 'ProactiveNotificationRunnerError';
    this.category = category;
    this.exitCode = exitCode;
  }
}

function configurationError(message) {
  return new ProactiveNotificationRunnerError(
    'configuration', EXIT_CODES.CONFIGURATION, message,
  );
}

function invalidResponseError() {
  return new ProactiveNotificationRunnerError(
    'invalid_response',
    EXIT_CODES.INVALID_RESPONSE,
    '主动销售通知入口返回了不符合契约的响应',
  );
}

function parseConfiguration(environment) {
  const rawUrl = String(environment[URL_VARIABLE] ?? '').trim();
  const token = String(environment[TOKEN_VARIABLE] ?? '').trim();
  if (!rawUrl) throw configurationError(`缺少 ${URL_VARIABLE}`);
  if (!token) throw configurationError(`缺少 ${TOKEN_VARIABLE}`);
  if (/\s/u.test(token) || /\p{Cc}/u.test(token)) {
    throw configurationError(`${TOKEN_VARIABLE} 格式无效`);
  }
  let endpoint;
  try {
    endpoint = new URL(rawUrl);
  } catch {
    throw configurationError(`${URL_VARIABLE} 不是有效 URL`);
  }
  const secure = endpoint.protocol === 'https:';
  const loopback = endpoint.protocol === 'http:' &&
    LOOPBACK_HOSTS.has(endpoint.hostname);
  if (!secure && !loopback) {
    throw configurationError('主动通知入口必须使用 HTTPS；仅本机允许 HTTP');
  }
  if (endpoint.username || endpoint.password || endpoint.search || endpoint.hash) {
    throw configurationError('主动通知入口 URL 不得包含凭证、查询参数或片段');
  }
  endpoint.pathname = endpoint.pathname.replace(/\/$/u, '');
  if (!endpoint.pathname.endsWith(RUN_PATH)) {
    throw configurationError(`主动通知入口 URL 必须以 ${RUN_PATH} 结尾`);
  }
  const rawTimeout = String(environment[TIMEOUT_VARIABLE] ?? '').trim();
  const timeoutMs = rawTimeout ? Number(rawTimeout) : DEFAULT_TIMEOUT_MS;
  if (
    !Number.isSafeInteger(timeoutMs) || timeoutMs < 1_000 ||
    timeoutMs > 120_000
  ) {
    throw configurationError(`${TIMEOUT_VARIABLE} 必须介于 1000 和 120000`);
  }
  return { endpoint: endpoint.toString(), token, timeoutMs };
}

function plainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function validateResponse(value) {
  if (
    !plainObject(value) || value.mode !== 'scheduler-run' ||
    !STATUSES.has(value.status) ||
    typeof value.generatedAt !== 'string' ||
    !Number.isFinite(Date.parse(value.generatedAt)) ||
    !plainObject(value.summary) || !Array.isArray(value.warnings) ||
    value.warnings.length > 100
  ) throw invalidResponseError();
  const countNames = [
    'tenantCount', 'memberCount', 'plannedCount',
    'sentCount', 'skippedCount', 'failedCount',
  ];
  if (countNames.some((name) =>
    !Number.isSafeInteger(value.summary[name]) || value.summary[name] < 0)) {
    throw invalidResponseError();
  }
  if (value.warnings.some((item) =>
    typeof item !== 'string' || !item || item.length > 128)) {
    throw invalidResponseError();
  }
  if (
    value.summary.sentCount + value.summary.skippedCount +
      value.summary.failedCount > value.summary.plannedCount
  ) throw invalidResponseError();
  return {
    mode: value.mode,
    status: value.status,
    generatedAt: value.generatedAt,
    summary: Object.fromEntries(
      countNames.map((name) => [name, value.summary[name]]),
    ),
    warnings: [...value.warnings],
  };
}

async function boundedJson(response) {
  const advertised = Number(response.headers.get('content-length'));
  if (Number.isFinite(advertised) && advertised > MAX_RESPONSE_BYTES) {
    throw invalidResponseError();
  }
  const contentType = response.headers.get('content-type') ?? '';
  if (!contentType.toLowerCase().includes('application/json')) {
    throw invalidResponseError();
  }
  const text = await response.text();
  if (Buffer.byteLength(text, 'utf8') > MAX_RESPONSE_BYTES) {
    throw invalidResponseError();
  }
  try {
    return validateResponse(JSON.parse(text));
  } catch (error) {
    if (error instanceof ProactiveNotificationRunnerError) throw error;
    throw invalidResponseError();
  }
}

function exitCodeForStatus(status) {
  return {
    completed: EXIT_CODES.COMPLETED,
    plan_only: EXIT_CODES.PLAN_ONLY,
    disabled: EXIT_CODES.DISABLED,
    partial: EXIT_CODES.PARTIAL,
    blocked: EXIT_CODES.BLOCKED,
  }[status] ?? EXIT_CODES.INVALID_RESPONSE;
}

async function runProactiveSalesNotifications(environment, dependencies = {}) {
  try {
    const configuration = parseConfiguration(environment);
    const fetchImplementation = dependencies.fetchImplementation ?? globalThis.fetch;
    const signal = (dependencies.signalFactory ?? AbortSignal.timeout)(
      configuration.timeoutMs,
    );
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
      const timeout = signal.aborted || error?.name === 'AbortError' ||
        error?.name === 'TimeoutError';
      throw new ProactiveNotificationRunnerError(
        timeout ? 'timeout' : 'network',
        timeout ? EXIT_CODES.TIMEOUT : EXIT_CODES.NETWORK,
        timeout ? '主动销售通知调用超时' : '主动销售通知网络调用失败',
      );
    }
    if (!response.ok) {
      throw new ProactiveNotificationRunnerError(
        'http', EXIT_CODES.HTTP,
        `主动销售通知入口返回 HTTP ${String(response.status)}`,
      );
    }
    const result = await boundedJson(response);
    const exitCode = exitCodeForStatus(result.status);
    return {
      exitCode,
      output: {
        operation: 'proactive-sales-notifications',
        ok: result.status === 'completed',
        ...result,
        exitCode,
      },
    };
  } catch (error) {
    const normalized = error instanceof ProactiveNotificationRunnerError
      ? error
      : new ProactiveNotificationRunnerError(
        'network', EXIT_CODES.NETWORK, '主动销售通知调用失败',
      );
    return {
      exitCode: normalized.exitCode,
      output: {
        operation: 'proactive-sales-notifications',
        ok: false,
        status: 'error',
        category: normalized.category,
        exitCode: normalized.exitCode,
        message: normalized.message,
      },
    };
  }
}

export {
  EXIT_CODES,
  RUN_PATH,
  parseConfiguration,
  runProactiveSalesNotifications,
  validateResponse,
};
