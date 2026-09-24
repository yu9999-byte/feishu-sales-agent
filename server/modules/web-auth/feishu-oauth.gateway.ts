import { Injectable } from '@nestjs/common';
import * as lark from '@larksuiteoapi/node-sdk';

import type {
  TenantIntegration,
} from '@server/modules/agent-core/agent.types';
import {
  FeishuClientFactory,
} from '@server/modules/feishu/feishu-client.factory';
import type {
  FeishuOAuthGateway,
  FeishuOAuthIdentity,
} from './web-auth.ports';

@Injectable()
class FeishuOAuthApiGateway implements FeishuOAuthGateway {
  constructor(
    private readonly clients: FeishuClientFactory,
  ) {}

  async exchangeCode(
    integration: TenantIntegration,
    code: string,
    redirectUri: string,
  ): Promise<FeishuOAuthIdentity> {
    const client: lark.Client = this.clients.getClient(integration);
    const token = await client.accessToken.retrieveByAuthorizationCode({
      code,
      redirectUri,
    });
    const response = await client.authen.userInfo.get(
      {},
      lark.withUserAccessToken(token.accessToken),
    );
    const tenantKey: string | undefined = response.data?.tenant_key;
    const openId: string | undefined = response.data?.open_id;
    if (response.code !== 0 || !tenantKey || !openId) {
      throw new Error(
        `Feishu user identity failed with code ${String(response.code)}`,
      );
    }
    return {
      tenantKey,
      openId,
      displayName: response.data?.name?.trim() || '飞书用户',
    };
  }
}

export { FeishuOAuthApiGateway };
