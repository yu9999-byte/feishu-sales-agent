import { Injectable, Logger } from '@nestjs/common';
import * as lark from '@larksuiteoapi/node-sdk';

import type { TenantIntegration } from '@server/modules/agent-core/agent.types';
import { redactSensitiveText } from '@server/modules/agent-core/agent.redaction';

interface SafeSdkLogger {
  error(...messages: unknown[]): void;
  warn(...messages: unknown[]): void;
  info(...messages: unknown[]): void;
  debug(...messages: unknown[]): void;
  trace(...messages: unknown[]): void;
}

@Injectable()
export class FeishuClientFactory {
  private readonly logger: Logger = new Logger(FeishuClientFactory.name);
  private readonly clients: Map<string, lark.Client> =
    new Map<string, lark.Client>();
  private readonly sdkLogger: SafeSdkLogger = {
    error: (...messages: unknown[]): void => {
      this.logger.error(this.formatMessages(messages));
    },
    warn: (...messages: unknown[]): void => {
      this.logger.warn(this.formatMessages(messages));
    },
    info: (...messages: unknown[]): void => {
      this.logger.log(this.formatMessages(messages));
    },
    debug: (...messages: unknown[]): void => {
      this.logger.debug(this.formatMessages(messages));
    },
    trace: (...messages: unknown[]): void => {
      this.logger.verbose(this.formatMessages(messages));
    },
  };

  getClient(integration: TenantIntegration): lark.Client {
    const cacheKey: string = [
      integration.appType,
      integration.appId,
      integration.appSecretEnv,
    ].join(':');
    const existing: lark.Client | undefined = this.clients.get(cacheKey);
    if (existing) {
      return existing;
    }

    const appSecret: string | undefined =
      process.env[integration.appSecretEnv];
    if (!appSecret) {
      throw new Error(
        `App secret environment variable is missing: ` +
          integration.appSecretEnv,
      );
    }

    const client: lark.Client = new lark.Client({
      appId: integration.appId,
      appSecret,
      appType:
        integration.appType === 'isv'
          ? lark.AppType.ISV
          : lark.AppType.SelfBuild,
      domain: lark.Domain.Feishu,
      logger: this.sdkLogger,
      loggerLevel: lark.LoggerLevel.error,
    });
    this.clients.set(cacheKey, client);
    return client;
  }

  getRequestOptions(
    integration: TenantIntegration,
  ): ReturnType<typeof lark.withTenantKey> | undefined {
    return integration.appType === 'isv'
      ? lark.withTenantKey(integration.feishuTenantKey)
      : undefined;
  }

  private formatMessages(messages: unknown[]): string {
    const formatted: string = messages
      .map((message: unknown): string =>
        message instanceof Error ? message.message : String(message),
      )
      .join(' ');
    return redactSensitiveText(formatted);
  }
}
