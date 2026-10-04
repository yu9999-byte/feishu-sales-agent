import { createHash } from 'node:crypto';

import type {
  TenantIntegration,
} from '@server/modules/agent-core/agent.types';
import {
  RetryableStaleOpportunityReminderError,
} from '@server/modules/insight/stale-opportunity-reminder.service';
import type {
  StaleOpportunityReminderMessage,
  StaleOpportunityReminderSender,
} from '@server/modules/insight/stale-opportunity-reminder.service';
import {
  assertFeishuSuccess,
  FeishuApiError,
  requireFeishuId,
} from './feishu-api.error';
import { FeishuClientFactory } from './feishu-client.factory';

interface FeishuStaleOpportunityReminderIntegrationReader {
  resolveTenantById(tenantId: string): Promise<TenantIntegration | null>;
}

class FeishuStaleOpportunityReminderSender
implements StaleOpportunityReminderSender {
  constructor(
    private readonly control:
      FeishuStaleOpportunityReminderIntegrationReader,
    private readonly clients: FeishuClientFactory,
  ) {}

  async send(
    message: StaleOpportunityReminderMessage,
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
        params: {
          receive_id_type: 'open_id',
        },
        data: {
          receive_id: message.recipientOpenId,
          msg_type: 'text',
          content: JSON.stringify({ text: this.renderText(message) }),
          uuid: this.uuid(message.idempotencyKey),
        },
      },
      requestOptions,
    );

    try {
      assertFeishuSuccess(
        response.code,
        response.msg,
        'send stale opportunity reminder',
      );
    } catch (error: unknown) {
      if (error instanceof FeishuApiError) {
        throw new RetryableStaleOpportunityReminderError(error.message);
      }
      throw error;
    }

    return {
      messageId: requireFeishuId(
        response.data?.message_id,
        'send stale opportunity reminder',
      ),
    };
  }

  private validate(message: StaleOpportunityReminderMessage): void {
    const requiredValues: string[] = [
      message.tenantId,
      message.recipientOpenId,
      message.opportunityRecordId,
      message.opportunityName,
      message.followupRecordId,
      message.lastEffectiveFollowupAt,
      message.suggestedAction,
      message.idempotencyKey,
    ];
    if (requiredValues.some((value: string): boolean => !value.trim())) {
      throw new RetryableStaleOpportunityReminderError(
        'Reminder sender input is incomplete',
      );
    }
  }

  private async resolveIntegration(
    tenantId: string,
  ): Promise<TenantIntegration> {
    let integration: TenantIntegration | null;
    try {
      integration = await this.control.resolveTenantById(tenantId);
    } catch (_error: unknown) {
      throw new RetryableStaleOpportunityReminderError(
        'Reminder tenant lookup is unavailable',
      );
    }
    if (
      integration === null ||
      integration.status !== 'active' ||
      integration.tenantId !== tenantId
    ) {
      throw new RetryableStaleOpportunityReminderError(
        'Reminder tenant is unavailable',
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
      throw new RetryableStaleOpportunityReminderError(
        'Reminder sender configuration is unavailable',
      );
    }
  }

  private resolveRequestOptions(
    integration: TenantIntegration,
  ): ReturnType<FeishuClientFactory['getRequestOptions']> {
    try {
      return this.clients.getRequestOptions(integration);
    } catch (_error: unknown) {
      throw new RetryableStaleOpportunityReminderError(
        'Reminder sender request configuration is unavailable',
      );
    }
  }

  private renderText(message: StaleOpportunityReminderMessage): string {
    const opportunityName: string = this.singleLine(
      message.opportunityName,
    );
    const followupAt: string = this.singleLine(
      message.lastEffectiveFollowupAt,
    );
    const suggestedAction: string = this.singleLine(
      message.suggestedAction,
    );
    return [
      '商机跟进提醒',
      '',
      `商机：${opportunityName}`,
      '情况：已超过 7 天没有可核实的有效跟进',
      `最近有效跟进时间：${followupAt}`,
      `建议动作：${suggestedAction}`,
      '',
      '请先确认商机最新状态，再开展后续跟进。',
    ].join('\n');
  }

  private singleLine(value: string): string {
    return value.trim().replace(/\s+/gu, ' ').slice(0, 500);
  }

  private uuid(value: string): string {
    return createHash('sha256').update(value).digest('hex').slice(0, 40);
  }
}

export { FeishuStaleOpportunityReminderSender };
export type { FeishuStaleOpportunityReminderIntegrationReader };
