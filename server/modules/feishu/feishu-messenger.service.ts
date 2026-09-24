import { createHash } from 'node:crypto';

import { Injectable } from '@nestjs/common';

import type {
  AgentExecutionResult,
  JsonObject,
} from '@shared/api.interface';
import type { FeishuMessenger } from '@server/modules/agent-core/agent.ports';
import type {
  PendingAction,
  TenantIntegration,
} from '@server/modules/agent-core/agent.types';
import type { FollowupProjectRiskInsight } from '@server/modules/insight/followup-project-risk.service';
import {
  createConfirmationCard,
  createProjectRiskCard,
  createResultCard,
} from '@server/modules/agent-core/agent.cards';
import {
  assertFeishuSuccess,
  requireFeishuId,
} from './feishu-api.error';
import { FeishuClientFactory } from './feishu-client.factory';

interface CardUpdateResponse {
  code?: number;
  msg?: string;
}

@Injectable()
export class FeishuMessengerService implements FeishuMessenger {
  constructor(private readonly clients: FeishuClientFactory) {}

  async sendText(
    integration: TenantIntegration,
    chatId: string,
    text: string,
    idempotencyKey: string,
  ): Promise<string> {
    const client = this.clients.getClient(integration);
    const response = await client.im.message.create(
      {
        params: {
          receive_id_type: 'chat_id',
        },
        data: {
          receive_id: chatId,
          msg_type: 'text',
          content: JSON.stringify({ text }),
          uuid: this.uuid(idempotencyKey),
        },
      },
      this.clients.getRequestOptions(integration),
    );
    assertFeishuSuccess(response.code, response.msg, 'send text message');
    return requireFeishuId(
      response.data?.message_id,
      'send text message',
    );
  }

  async updateText(
    integration: TenantIntegration,
    messageId: string,
    text: string,
  ): Promise<void> {
    const client = this.clients.getClient(integration);
    const response = await client.im.message.update(
      {
        path: { message_id: messageId },
        data: {
          msg_type: 'text',
          content: JSON.stringify({ text }),
        },
      },
      this.clients.getRequestOptions(integration),
    );
    assertFeishuSuccess(response.code, response.msg, 'edit text message');
  }

  async sendConfirmationCard(
    integration: TenantIntegration,
    chatId: string,
    action: PendingAction,
  ): Promise<string> {
    const client = this.clients.getClient(integration);
    const card: JsonObject = createConfirmationCard(action);
    const response = await client.im.message.create(
      {
        params: {
          receive_id_type: 'chat_id',
        },
        data: {
          receive_id: chatId,
          msg_type: 'interactive',
          content: JSON.stringify(card),
          uuid: this.uuid(`${action.id}:confirmation-card`),
        },
      },
      this.clients.getRequestOptions(integration),
    );
    assertFeishuSuccess(
      response.code,
      response.msg,
      'send confirmation card',
    );
    return requireFeishuId(
      response.data?.message_id,
      'send confirmation card',
    );
  }

  async updateCard(
    integration: TenantIntegration,
    cardMessageId: string,
    card: JsonObject,
  ): Promise<void> {
    const client = this.clients.getClient(integration);
    const response: CardUpdateResponse =
      await client.im.message.patch(
        {
          path: {
            message_id: cardMessageId,
          },
          data: {
            content: JSON.stringify(card),
          },
        },
        this.clients.getRequestOptions(integration),
      );
    assertFeishuSuccess(
      response.code,
      response.msg,
      'update sent interactive card',
    );
  }

  async sendResultCard(
    integration: TenantIntegration,
    chatId: string,
    action: PendingAction,
    result: AgentExecutionResult,
  ): Promise<string> {
    const client = this.clients.getClient(integration);
    const response = await client.im.message.create(
      {
        params: {
          receive_id_type: 'chat_id',
        },
        data: {
          receive_id: chatId,
          msg_type: 'interactive',
          content: JSON.stringify(createResultCard(result)),
          uuid: this.uuid(
            `${action.id}:result-card:${result.status}`,
          ),
        },
      },
      this.clients.getRequestOptions(integration),
    );
    assertFeishuSuccess(response.code, response.msg, 'send result card');
    return requireFeishuId(response.data?.message_id, 'send result card');
  }

  async sendProjectRiskCard(
    integration: TenantIntegration,
    chatId: string,
    action: PendingAction,
    insight: FollowupProjectRiskInsight,
  ): Promise<string> {
    const client = this.clients.getClient(integration);
    const response = await client.im.message.create(
      {
        params: {
          receive_id_type: 'chat_id',
        },
        data: {
          receive_id: chatId,
          msg_type: 'interactive',
          content: JSON.stringify(createProjectRiskCard(action, insight)),
          uuid: this.uuid(`${action.id}:project-risk-card`),
        },
      },
      this.clients.getRequestOptions(integration),
    );
    assertFeishuSuccess(
      response.code,
      response.msg,
      'send project risk card',
    );
    return requireFeishuId(
      response.data?.message_id,
      'send project risk card',
    );
  }

  private uuid(value: string): string {
    return createHash('sha256').update(value).digest('hex').slice(0, 40);
  }
}
