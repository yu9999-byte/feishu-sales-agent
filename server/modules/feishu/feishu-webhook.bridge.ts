import { createHash } from 'node:crypto';

import { Inject, Injectable, Logger } from '@nestjs/common';
import * as lark from '@larksuiteoapi/node-sdk';
import { z } from 'zod';

import type { Request, Response } from 'express';
import type { JsonObject } from '@shared/api.interface';
import {
  AGENT_CONFIG,
  type AgentRuntimeConfig,
} from '@server/config/agent.config';
import { AgentWorkflowService } from '@server/modules/agent-core/agent-workflow.service';
import type {
  IncomingCardAction,
  IncomingMessage,
} from '@server/modules/agent-core/agent.types';
import { parseJsonObject } from '@server/modules/agent-core/agent.validation';
import {
  redactErrorMessage,
  redactErrorStack,
  redactSensitiveText,
} from '@server/modules/agent-core/agent.redaction';

type MessageReceiveHandler = NonNullable<
  lark.EventHandles['im.message.receive_v1']
>;
type MessageReceiveEvent = Parameters<MessageReceiveHandler>[0];

interface SafeSdkLogger {
  error(...messages: unknown[]): void;
  warn(...messages: unknown[]): void;
  info(...messages: unknown[]): void;
  debug(...messages: unknown[]): void;
  trace(...messages: unknown[]): void;
}

const textMessageContentSchema = z.object({
  text: z.string(),
});

const cardCallbackSchema = z.object({
  event_id: z.string().optional(),
  create_time: z.string().optional(),
  tenant_key: z.string().min(1),
  token: z.string().min(1),
  open_id: z.string().optional(),
  operator: z.object({
    open_id: z.string().optional(),
    operator_id: z.string().optional(),
  }).optional(),
  open_message_id: z.string().optional(),
  context: z.object({
    open_message_id: z.string().optional(),
    open_chat_id: z.string().optional(),
  }).optional(),
  action: z.object({
    value: z.unknown().optional(),
    form_value: z.unknown().optional(),
    name: z.string().optional(),
    tag: z.string(),
  }),
});

const decodeCardCallbackObject = (value: unknown): JsonObject => {
  if (value === undefined || value === null || value === '') {
    return {};
  }
  const decoded: unknown = typeof value === 'string'
    ? JSON.parse(value) as unknown
    : value;
  return parseJsonObject(decoded);
};

@Injectable()
class FeishuWebhookBridge {
  private readonly logger: Logger = new Logger(FeishuWebhookBridge.name);
  private readonly sdkLogger: SafeSdkLogger;
  private readonly eventHandler: (
    request: Request,
    response: Response,
  ) => Promise<void>;
  private readonly cardHandler: (
    request: Request,
    response: Response,
  ) => Promise<void>;

  constructor(
    private readonly workflow: AgentWorkflowService,
    @Inject(AGENT_CONFIG)
    config: AgentRuntimeConfig,
  ) {
    this.sdkLogger = this.createSdkLogger();
    const eventDispatcher: lark.EventDispatcher =
      new lark.EventDispatcher({
        verificationToken: config.feishu.verificationToken,
        encryptKey: config.feishu.encryptKey,
        logger: this.sdkLogger,
        loggerLevel: lark.LoggerLevel.error,
      }).register({
        'im.message.receive_v1': (
          data: MessageReceiveEvent,
        ): void => {
          let incoming: IncomingMessage;
          try {
            incoming = this.mapMessage(data);
          } catch (error: unknown) {
            const normalized: Error = this.toError(error);
            this.logger.error(
              `Feishu message mapping failed: ${redactErrorMessage(
                normalized,
              )}`,
              redactErrorStack(normalized),
            );
            throw error;
          }
          this.logger.log(
            `Feishu message mapped: message=${this.hashValue(
              incoming.messageId,
            )} tenant=${this.hashValue(
              incoming.feishuTenantKey,
            )} chatType=${incoming.chatType} messageType=${
              incoming.messageType
            }`,
          );
          queueMicrotask((): void => {
            this.logger.debug(
              `Feishu message workflow started: message=${this.hashValue(
                incoming.messageId,
              )}`,
            );
            void this.workflow.handleMessage(incoming)
              .then((): void => {
                this.logger.log(
                  `Feishu message workflow completed: message=${this.hashValue(
                    incoming.messageId,
                  )}`,
                );
              })
              .catch(
                (error: unknown): void => {
                  const normalized: Error = this.toError(error);
                  this.logger.error(
                    `Message workflow crashed: message=${this.hashValue(
                      incoming.messageId,
                    )} ${redactErrorMessage(normalized)}`,
                    redactErrorStack(normalized),
                  );
                },
              );
          });
        },
      });
    const cardActionHandler: lark.CardActionHandler =
      new lark.CardActionHandler(
        {
          verificationToken: config.feishu.verificationToken,
          encryptKey: config.feishu.encryptKey,
          logger: this.sdkLogger,
          loggerLevel: lark.LoggerLevel.error,
        },
        async (data: unknown): Promise<unknown> => {
          const incoming: IncomingCardAction = this.mapCardAction(data);
          return this.workflow.handleCardAction(incoming);
        },
      );

    this.eventHandler = lark.adaptExpress(eventDispatcher, {
      autoChallenge: true,
      logger: this.sdkLogger,
    });
    this.cardHandler = lark.adaptExpress(cardActionHandler, {
      autoChallenge: true,
      logger: this.sdkLogger,
    });
  }

  async handleEvent(
    request: Request,
    response: Response,
  ): Promise<void> {
    this.logger.debug(
      `Feishu event HTTP received: method=${request.method} path=${request.path}`,
    );
    try {
      await this.eventHandler(request, response);
    } catch (error: unknown) {
      const normalized: Error = this.toError(error);
      this.logger.error(
        `Feishu event HTTP failed: ${redactErrorMessage(normalized)}`,
        redactErrorStack(normalized),
      );
      throw error;
    }
  }

  async handleCard(
    request: Request,
    response: Response,
  ): Promise<void> {
    this.logger.debug(
      `Feishu card HTTP received: method=${request.method} path=${request.path}`,
    );
    try {
      await this.cardHandler(request, response);
    } catch (error: unknown) {
      const normalized: Error = this.toError(error);
      this.logger.error(
        `Feishu card HTTP failed: ${redactErrorMessage(normalized)}`,
        redactErrorStack(normalized),
      );
      throw error;
    }
  }

  private mapMessage(data: MessageReceiveEvent): IncomingMessage {
    const tenantKey: string | undefined =
      data.tenant_key ?? data.sender.tenant_key;
    const senderOpenId: string | undefined = data.sender.sender_id?.open_id;
    if (!tenantKey || !senderOpenId) {
      throw new Error('Feishu message is missing tenant or sender identity');
    }
    if (data.message.chat_type !== 'p2p' && data.message.chat_type !== 'group') {
      throw new Error('Feishu message has an unsupported chat type');
    }

    let text: string = '';
    if (data.message.message_type === 'text') {
      const parsedContent: unknown = JSON.parse(data.message.content);
      text = textMessageContentSchema.parse(parsedContent).text;
    }

    return {
      feishuTenantKey: tenantKey,
      messageId: data.message.message_id,
      chatId: data.message.chat_id,
      chatType: data.message.chat_type,
      messageType: data.message.message_type,
      senderOpenId,
      senderType: data.sender.sender_type,
      text,
      receivedAt: this.parseTimestamp(data.message.create_time),
    };
  }

  private mapCardAction(data: unknown): IncomingCardAction {
    const parsed = cardCallbackSchema.parse(data);
    const operatorOpenId: string | undefined =
      parsed.open_id ??
      parsed.operator?.open_id ??
      parsed.operator?.operator_id;
    if (!operatorOpenId) {
      throw new Error('Feishu card action is missing operator identity');
    }
    const actionValue: JsonObject = decodeCardCallbackObject(
      parsed.action.value,
    );
    const formValue: JsonObject = decodeCardCallbackObject(
      parsed.action.form_value,
    );
    const cardMessageId: string | null = parsed.open_message_id ??
      parsed.context?.open_message_id ?? null;
    const chatId: string | null = parsed.context?.open_chat_id ?? null;
    const eventId: string = parsed.event_id ?? this.hashEvent([
      parsed.tenant_key,
      operatorOpenId,
      cardMessageId ?? '',
      parsed.action.name ?? '',
      JSON.stringify(actionValue),
      JSON.stringify(formValue),
    ]);

    return {
      feishuTenantKey: parsed.tenant_key,
      eventId,
      operatorOpenId,
      callbackToken: parsed.token,
      cardMessageId,
      chatId,
      actionName: parsed.action.name ?? null,
      value: actionValue,
      formValue,
      receivedAt: this.parseTimestamp(parsed.create_time),
    };
  }

  private parseTimestamp(value: string | undefined): Date {
    if (!value) {
      return new Date();
    }
    let numeric: number = Number(value);
    if (Number.isFinite(numeric)) {
      while (Math.abs(numeric) > 10_000_000_000_000) {
        numeric /= 1000;
      }
      while (Math.abs(numeric) < 100_000_000_000) {
        numeric *= 1000;
      }
      return new Date(numeric);
    }
    const parsed: number = Date.parse(value);
    return Number.isNaN(parsed) ? new Date() : new Date(parsed);
  }

  private hashEvent(parts: string[]): string {
    return createHash('sha256').update(parts.join(':')).digest('hex');
  }

  private hashValue(value: string): string {
    return createHash('sha256').update(value).digest('hex').slice(0, 12);
  }

  private createSdkLogger(): SafeSdkLogger {
    return {
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
  }

  private formatMessages(messages: unknown[]): string {
    const formatted: string = messages
      .map((message: unknown): string =>
        message instanceof Error ? message.message : String(message),
      )
      .join(' ');
    return redactSensitiveText(formatted);
  }

  private toError(error: unknown): Error {
    return error instanceof Error ? error : new Error(String(error));
  }
}

export { decodeCardCallbackObject, FeishuWebhookBridge };
