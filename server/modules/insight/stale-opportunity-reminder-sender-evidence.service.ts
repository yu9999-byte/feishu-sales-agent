import { Inject, Injectable } from '@nestjs/common';

import type {
  StaleOpportunityReminderSenderEvidence,
  StaleOpportunityReminderSenderScope,
} from '@shared/api.interface';
import {
  AGENT_CONFIG,
  type AgentRuntimeConfig,
} from '@server/config/agent.config';
import {
  CONTROL_STORE,
} from '@server/modules/agent-core/agent.ports';
import type {
  TenantIntegration,
} from '@server/modules/agent-core/agent.types';
import {
  assertFeishuSuccess,
} from '@server/modules/feishu/feishu-api.error';
import {
  FeishuClientFactory,
} from '@server/modules/feishu/feishu-client.factory';
import {
  IDENTITY_ACCESS_REPOSITORY,
} from '@server/modules/identity-access/identity-access.ports';
import type {
  PlatformMember,
} from '@server/modules/identity-access/identity-access.types';

interface SenderEvidenceControlReader {
  resolveTenantById(tenantId: string): Promise<TenantIntegration | null>;
}

interface SenderEvidenceIdentityReader {
  resolveMemberById(
    tenantId: string,
    memberId: string,
  ): Promise<PlatformMember | null>;
}

interface SenderEvidenceInput {
  now?: Date;
}

interface BotInfoResponse {
  code?: number;
  msg?: string;
  bot?: {
    activate_status?: number;
    open_id?: string;
  };
}

const SEND_SCOPES: StaleOpportunityReminderSenderScope[] = [
  'im:message:send_as_bot',
  'im:message',
  'im:message:send',
];

const VISIBILITY_INSPECTION_SCOPES: Set<string> = new Set([
  'application:application:self_manage',
  'admin:app.info:readonly',
]);

@Injectable()
class StaleOpportunityReminderSenderEvidenceService {
  constructor(
    @Inject(AGENT_CONFIG)
    private readonly config: AgentRuntimeConfig,
    @Inject(CONTROL_STORE)
    private readonly controlStore: SenderEvidenceControlReader,
    @Inject(IDENTITY_ACCESS_REPOSITORY)
    private readonly identity: SenderEvidenceIdentityReader,
    @Inject(FeishuClientFactory)
    private readonly clients: FeishuClientFactory,
  ) {}

  async inspect(
    input: SenderEvidenceInput = {},
  ): Promise<StaleOpportunityReminderSenderEvidence> {
    const now: Date = input.now ?? new Date();
    const execution = this.config.staleOpportunityReminder?.execution;
    const tenantId: string | undefined = execution?.allowedTenantId?.trim();
    const memberId: string | undefined = execution?.allowedMemberId?.trim();
    const recipientOpenId: string | undefined =
      execution?.allowedRecipientOpenId?.trim();
    if (!tenantId || !memberId || !recipientOpenId) {
      return this.empty(
        'not_checked',
        now,
        ['stale_opportunity_sender_target_not_configured'],
      );
    }

    let integration: TenantIntegration | null;
    let member: PlatformMember | null;
    try {
      [integration, member] = await Promise.all([
        this.controlStore.resolveTenantById(tenantId),
        this.identity.resolveMemberById(tenantId, memberId),
      ]);
    } catch (_error: unknown) {
      return this.empty(
        'unavailable',
        now,
        ['stale_opportunity_sender_target_unavailable'],
      );
    }
    if (
      integration === null || integration.tenantId !== tenantId ||
      integration.status !== 'active' || member === null ||
      member.tenantId !== tenantId || member.id !== memberId ||
      member.status !== 'active' || member.feishuOpenId !== recipientOpenId
    ) {
      return this.empty(
        'unavailable',
        now,
        ['stale_opportunity_sender_target_unavailable'],
      );
    }

    const client: ReturnType<FeishuClientFactory['getClient']> | null =
      this.resolveClient(integration);
    if (client === null) {
      return this.empty(
        'unavailable',
        now,
        ['stale_opportunity_sender_credentials_unavailable'],
      );
    }
    let requestOptions: ReturnType<
      FeishuClientFactory['getRequestOptions']
    >;
    try {
      requestOptions = this.clients.getRequestOptions(integration);
    } catch (_error: unknown) {
      return this.empty(
        'unavailable',
        now,
        ['stale_opportunity_sender_credentials_unavailable'],
      );
    }

    let botResponse: BotInfoResponse;
    try {
      botResponse = await client.request<BotInfoResponse>({
        url: '/open-apis/bot/v3/info',
        method: 'GET',
      }, requestOptions);
      assertFeishuSuccess(
        botResponse.code,
        botResponse.msg,
        'inspect reminder bot identity',
      );
    } catch (_error: unknown) {
      return this.empty(
        'unavailable',
        now,
        ['stale_opportunity_sender_bot_unavailable'],
      );
    }

    const botOpenIdPresent: boolean = Boolean(botResponse.bot?.open_id?.trim());
    const botEnabled: boolean = botResponse.bot?.activate_status === 2 &&
      botOpenIdPresent;
    const warnings: string[] = [];
    if (!botEnabled) warnings.push('stale_opportunity_sender_bot_disabled');

    let scopeResponse: Awaited<ReturnType<
      typeof client.application.scope.list
    >>;
    try {
      scopeResponse = await client.application.scope.list(
        {},
        requestOptions,
      );
      assertFeishuSuccess(
        scopeResponse.code,
        scopeResponse.msg,
        'inspect reminder sender scopes',
      );
    } catch (_error: unknown) {
      return {
        ...this.empty(
          'unavailable',
          now,
          ['stale_opportunity_sender_scope_unavailable'],
        ),
        credentialsStatus: 'valid',
        botStatus: botEnabled ? 'enabled' : 'disabled',
        botOpenIdPresent,
      };
    }

    const grantedScopes: Set<string> = new Set(
      (scopeResponse.data?.scopes ?? [])
        .filter((scope): boolean =>
          scope.grant_status === 1 && scope.scope_type !== 'user',
        )
        .map((scope): string => scope.scope_name),
    );
    const grantedSendScope: StaleOpportunityReminderSenderScope | null =
      SEND_SCOPES.find(
        (scope: StaleOpportunityReminderSenderScope): boolean =>
          grantedScopes.has(scope),
      ) ?? null;
    if (grantedSendScope === null) {
      warnings.push('stale_opportunity_sender_permission_missing');
    }

    const inspectionPermissionGranted: boolean = Array.from(
      VISIBILITY_INSPECTION_SCOPES,
    ).some((scope: string): boolean => grantedScopes.has(scope));
    let recipientVisibility:
      StaleOpportunityReminderSenderEvidence['recipientVisibility'] = {
        status: 'not_checked',
        inspectionPermissionGranted,
      };
    if (!inspectionPermissionGranted) {
      warnings.push('stale_opportunity_sender_recipient_visibility_not_checked');
    } else {
      try {
        const visibility = await client.application.applicationVisibility
          .checkWhiteBlackList({
            path: { app_id: integration.appId },
            params: { user_id_type: 'open_id' },
            data: { user_ids: [recipientOpenId] },
          }, requestOptions);
        assertFeishuSuccess(
          visibility.code,
          visibility.msg,
          'inspect reminder recipient visibility',
        );
        const target = visibility.data?.user_visibility_list?.find(
          (item): boolean => item.user_id === recipientOpenId,
        );
        const visible: boolean = Boolean(
          target && target.in_black_list !== true &&
          (target.in_white_list === true || target.in_paid_list === true),
        );
        recipientVisibility = {
          status: visible ? 'visible' : 'not_visible',
          inspectionPermissionGranted: true,
        };
        if (!visible) {
          warnings.push('stale_opportunity_sender_recipient_not_visible');
        }
      } catch (_error: unknown) {
        recipientVisibility = {
          status: 'unavailable',
          inspectionPermissionGranted: true,
        };
        warnings.push(
          'stale_opportunity_sender_recipient_visibility_unavailable',
        );
      }
    }

    const complete: boolean = botEnabled && grantedSendScope !== null &&
      recipientVisibility.status !== 'not_visible' &&
      recipientVisibility.status !== 'unavailable';
    return {
      status: complete ? 'complete' : 'incomplete',
      checkedAt: now.toISOString(),
      credentialsStatus: 'valid',
      botStatus: botEnabled ? 'enabled' : 'disabled',
      botOpenIdPresent,
      sendPermissionStatus: grantedSendScope === null ? 'missing' : 'granted',
      grantedSendScope,
      recipientVisibility,
      warnings: Array.from(new Set<string>(warnings)).sort(),
    };
  }

  private resolveClient(
    integration: TenantIntegration,
  ): ReturnType<FeishuClientFactory['getClient']> | null {
    try {
      return this.clients.getClient(integration);
    } catch (_error: unknown) {
      return null;
    }
  }

  private empty(
    status: 'unavailable' | 'not_checked',
    now: Date,
    warnings: string[],
  ): StaleOpportunityReminderSenderEvidence {
    return {
      status,
      checkedAt: now.toISOString(),
      credentialsStatus: status === 'unavailable'
        ? 'unavailable'
        : 'not_checked',
      botStatus: status === 'unavailable' ? 'unavailable' : 'not_checked',
      botOpenIdPresent: false,
      sendPermissionStatus: status === 'unavailable'
        ? 'unavailable'
        : 'not_checked',
      grantedSendScope: null,
      recipientVisibility: {
        status: 'not_checked',
        inspectionPermissionGranted: false,
      },
      warnings: Array.from(new Set<string>(warnings)).sort(),
    };
  }
}

export { StaleOpportunityReminderSenderEvidenceService };
export type {
  SenderEvidenceControlReader,
  SenderEvidenceIdentityReader,
  SenderEvidenceInput,
};
