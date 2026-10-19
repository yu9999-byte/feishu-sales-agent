#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { NestFactory } from '@nestjs/core';

const main = async () => {
  const [file, flag, ...extra] = process.argv.slice(2);
  if (!file || (flag && flag !== '--send') || extra.length) {
    throw new Error('Usage: node --env-file=.env.local scripts/today-action-acceptance.mjs <input.json> [--send]');
  }
  const input = JSON.parse(await readFile(resolve(file), 'utf8'));
  const load = async (filePath, symbol) => {
    const module = await import(pathToFileURL(resolve(filePath)).href);
    return module[symbol] ?? module.default?.[symbol];
  };
  const Module = await load('dist/server/modules/insight/proactive-sales-notification.module.js', 'ProactiveSalesNotificationModule');
  const Service = await load('dist/server/modules/insight/proactive-sales-notification.service.js', 'ProactiveSalesNotificationService');
  const app = await NestFactory.createApplicationContext(Module, { logger: false });
  try {
    const result = await app.get(Service).runAcceptance({
      tenantId: input.tenantId, memberId: input.memberId, recipientOpenId: input.recipientOpenId,
      itemIds: input.itemIds, marker: input.marker, runKey: input.runKey, send: flag === '--send',
    });
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } finally { await app.close(); }
};

try { await main(); }
catch (error) {
  process.stderr.write(`${JSON.stringify({ status: 'error', message: error instanceof Error ? error.message : 'Acceptance failed' })}\n`);
  process.exitCode = 1;
}
