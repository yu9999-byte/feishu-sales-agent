import { setTimeout as delay } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';

async function waitForAgentReadiness({
  port = 3100, waitMs = 0, requestTimeoutMs = 4000, intervalMs = 500,
} = {}) {
  if (
    !Number.isSafeInteger(port) || port < 1 || port > 65535 ||
    !Number.isSafeInteger(waitMs) || waitMs < 0 || waitMs > 120000 ||
    !Number.isSafeInteger(requestTimeoutMs) || requestTimeoutMs < 1 ||
    !Number.isSafeInteger(intervalMs) || intervalMs < 1
  ) throw new Error('Invalid readiness options');
  const deadline = performance.now() + waitMs;
  do {
    const remaining = Math.max(1, deadline - performance.now());
    const timeout = waitMs === 0 ? requestTimeoutMs : Math.min(requestTimeoutMs, remaining);
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/health/ready`, {
        redirect: 'error', signal: AbortSignal.timeout(Math.ceil(timeout)),
        headers: { Accept: 'application/json' },
      });
      if (response.ok) {
        const result = await response.json();
        if (
          result?.status === 'ready' && result.database === 'ready' &&
          typeof result.checkedAt === 'string' && Number.isFinite(Date.parse(result.checkedAt))
        ) return { status: 'ready' };
      } else {
        await response.body?.cancel();
      }
    } catch {
      // Readiness failures expose no response body, credentials or network details.
    }
    if (performance.now() >= deadline) break;
    await delay(Math.min(intervalMs, Math.max(1, deadline - performance.now())));
  } while (performance.now() < deadline);
  return { status: 'not_ready' };
}

async function main() {
  try {
    const args = process.argv.slice(2);
    const options = { port: Number(process.env.AGENT_PORT || 3100), waitMs: 0 };
    for (let index = 0; index < args.length; index += 2) {
      const key = args[index];
      if (!['--port', '--wait-ms'].includes(key) || args[index + 1] === undefined) {
        throw new Error('Invalid readiness options');
      }
      options[key === '--port' ? 'port' : 'waitMs'] = Number(args[index + 1]);
    }
    const result = await waitForAgentReadiness(options);
    process.stdout.write(`${JSON.stringify(result)}\n`);
    process.exitCode = result.status === 'ready' ? 0 : 1;
  } catch {
    process.stderr.write('Invalid readiness options\n');
    process.exitCode = 2;
  }
}

const invoked = process.argv[1] ? pathToFileURL(process.argv[1]).href : '';
if (import.meta.url === invoked) await main();

export { waitForAgentReadiness };
