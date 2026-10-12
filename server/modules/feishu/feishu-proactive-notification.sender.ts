import { createHash } from 'node:crypto';

import type { TenantIntegration } from '@server/modules/agent-core/agent.types';
import {
  createProactiveNotificationCard,
} from '@server/modules/insight/proactive-notification.card';
import {
  RetryableProactiveNotificationError,
  type ProactiveNotificationMessage,
  type ProactiveNotificationSender,
} from '@server/modules/insight/proactive-notification-delivery.service';
import {
  assertFeishuSuccess,
  FeishuApiError,
  requireFeishuId,
} from './feishu-api.error';
import { FeishuClientFactory } from './feishu-client.factory';

interface ProactiveNotificationIntegrationReader {
  resolveTenantById(tenantId: string): Promise<TenantIntegration | null>;
}

class FeishuProactiveNotificationSender
implements ProactiveNotificationSender {
  constructor(
    private readonly control: ProactiveNotificationIntegrationReader,
    private readonly clients: FeishuClientFactory,
  ) {}

  async send(
    message: ProactiveNotificationMessage,
  ): Promise<{ messageId: string }> {
    this.validate(message);
    const integration: TenantIntegration =
      await this.resolveIntegration(message.tenantId);
    const client: ReturnType<FeishuClientFactory['getClient']> =
      this.resolveClient(integration);
    const requestOptions: ReturnType<
      FeishuClientFactory['getRequestOptions']
    > = this.resolveRequestOptions(integration);
    const response = await client.im.message.create(
      {
        params: { receive_id_type: 'open_id' },
        data: {
          receive_id: message.recipientOpenId,
          msg_type: 'interactive',
          content: JSON.stringify(createProactiveNotificationCard(message)),
          uuid: this.uuid([
            message.tenantId,
            message.recipientMemberId,
            message.kind,
            message.notificationKey,
          ].join(':')),
        },
      },
      requestOptions,
    );
    try {
      assertFeishuSuccess(
        response.code,
        response.msg,
        'send proactive sales notification',
      );
    } catch (error: unknown) {
      if (error instanceof FeishuApiError) {
        throw new RetryableProactiveNotificationError(error.message);
      }
      throw error;
    }
    return {
      messageId: requireFeishuId(
        response.data?.message_id,
        'send proactive sales notification',
      ),
    };
  }

  private async resolveIntegration(
    tenantId: string,
  ): Promise<TenantIntegration> {
    let integration: TenantIntegration | null;
    try {
      integration = await this.control.resolveTenantById(tenantId);
    } catch (_error: unknown) {
      throw new RetryableProactiveNotificationError(
        'Proactive notification tenant lookup is unavailable',
      );
    }
    if (
      integration === null || integration.status !== 'active' ||
      integration.tenantId !== tenantId
    ) {
      throw new RetryableProactiveNotificationError(
        'Proactive notification tenant is unavailable',
      );
    }
    return integration;
  }

  private resolveClient(
    integration: TenantIntegration,
  ): ReturnType<FeishuClientFactory['getClient']> {
    try {
      return this.clients.getClient(integration);
    } catch (_error: unknown) {
      throw new RetryableProactiveNotificationError(
        'Proactive notification sender configuration is unavailable',
      );
    }
  }

  private resolveRequestOptions(
    integration: TenantIntegration,
  ): ReturnType<FeishuClientFactory['getRequestOptions']> {
    try {
      return this.clients.getRequestOptions(integration);
    } catch (_error: unknown) {
      throw new RetryableProactiveNotificationError(
        'Proactive notification request configuration is unavailable',
      );
    }
  }

  private validate(message: ProactiveNotificationMessage): void {
    const required: string[] = [
      message.tenantId,
      message.recipientMemberId,
      message.recipientOpenId,
      message.notificationKey,
      message.subjectKey,
      message.title,
      message.payloadFingerprint,
    ];
    if (
      required.some((value: string): boolean => !value.trim()) ||
      message.sections.length === 0
    ) {
      throw new RetryableProactiveNotificationError(
        'Proactive notification input is incomplete',
      );
    }
  }

  private uuid(value: string): string {
    return createHash('sha256').update(value).digest('hex').slice(0, 40);
  }
}

export { FeishuProactiveNotificationSender };
export type { ProactiveNotificationIntegrationReader };
