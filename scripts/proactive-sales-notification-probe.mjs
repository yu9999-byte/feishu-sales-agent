#!/usr/bin/env node

import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { NestFactory } from '@nestjs/core';

const parseFixedTime = (value) => {
  const now = new Date(value);
  if (!value || !Number.isFinite(now.getTime())) {
    throw new Error('Usage: npm run probe:proactive-sales-notifications -- <ISO time>');
  }
  return now;
};

const loadCompiledSymbol = async (path, name) => {
  const moduleUrl = pathToFileURL(resolve(path)).href;
  const loaded = await import(moduleUrl);
  const symbol = loaded[name] ?? loaded.default?.[name];
  if (!symbol) throw new Error(`Compiled symbol unavailable: ${name}`);
  return symbol;
};

const main = async () => {
  const now = parseFixedTime(process.argv[2]);
  const ProactiveSalesNotificationModule = await loadCompiledSymbol(
    'dist/server/modules/insight/proactive-sales-notification.module.js',
    'ProactiveSalesNotificationModule',
  );
  const ProactiveSalesNotificationService = await loadCompiledSymbol(
    'dist/server/modules/insight/proactive-sales-notification.service.js',
    'ProactiveSalesNotificationService',
  );
  const app = await NestFactory.createApplicationContext(
    ProactiveSalesNotificationModule,
    { logger: false },
  );
  try {
    const service = app.get(ProactiveSalesNotificationService);
    const result = await service.run({ now });
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } finally {
    await app.close();
  }
};

try {
  await main();
} catch (error) {
  const message = error instanceof Error ? error.message : 'Probe failed';
  process.stderr.write(`${JSON.stringify({ status: 'error', message })}\n`);
  process.exitCode = 1;
}
