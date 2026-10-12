#!/usr/bin/env node

import { pathToFileURL } from 'node:url';

import {
  runProactiveSalesNotifications,
} from './proactive-sales-notification-runner-lib.mjs';

async function main() {
  const result = await runProactiveSalesNotifications(process.env);
  const output = `${JSON.stringify(result.output)}\n`;
  if (result.exitCode === 0) process.stdout.write(output);
  else process.stderr.write(output);
  process.exitCode = result.exitCode;
}

const invoked = process.argv[1] ? pathToFileURL(process.argv[1]).href : '';
if (import.meta.url === invoked) await main();

export { main };
