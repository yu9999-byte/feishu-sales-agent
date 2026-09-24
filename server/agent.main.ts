import { config as loadEnvironment } from 'dotenv';
import { join } from 'node:path';

import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import express from 'express';

import { AgentAppModule } from './agent-app.module';
import {
  AGENT_CONFIG,
  type AgentRuntimeConfig,
} from './config/agent.config';

loadEnvironment({
  path: ['.env.local', '.env'],
  quiet: true,
});

const bootstrap = async (): Promise<void> => {
  const app = await NestFactory.create(AgentAppModule, {
    abortOnError: true,
  });
  const config: AgentRuntimeConfig = app.get(AGENT_CONFIG);
  const logger: Logger = new Logger('SalesAgentBootstrap');

  app.use(express.static(join(process.cwd(), 'dist/agent-web')));
  app.enableShutdownHooks();
  await app.listen(config.port, config.host);
  logger.log(`Sales Agent listening on ${config.host}:${config.port}`);
  logger.log('Feishu event endpoint: /webhooks/feishu/events');
  logger.log('Feishu card endpoint: /webhooks/feishu/cards');
  logger.log('Web product: /');
};

void bootstrap();
