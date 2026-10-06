#!/usr/bin/env node

import { pathToFileURL } from 'node:url';

import {
  runScheduleObservation,
} from './stale-opportunity-schedule-observer-lib.mjs';

async function main() {
  const result = await runScheduleObservation(process.env);
  const serialized = `${JSON.stringify(result.output)}\n`;

  if (result.exitCode === 0) {
    process.stdout.write(serialized);
  } else {
    process.stderr.write(serialized);
  }
  process.exitCode = result.exitCode;
}

const invokedPath = process.argv[1] ? pathToFileURL(process.argv[1]).href : '';
if (import.meta.url === invokedPath) {
  await main();
}

export { main };
