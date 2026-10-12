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
  FeishuOAuthGrant,
  FeishuOAuthTokenResponse,
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
  ): Promise<FeishuOAuthGrant> {
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
    if (
      !token.refreshToken ||
      token.expiresIn === undefined ||
      token.expiresIn <= 0
    ) {
      throw new Error('Feishu OAuth grant did not include refresh metadata');
    }
    return {
      tenantKey,
      openId,
      displayName: response.data?.name?.trim() || '飞书用户',
      accessToken: token.accessToken,
      refreshToken: token.refreshToken,
      expiresIn: token.expiresIn,
      refreshTokenExpiresIn: token.refreshTokenExpiresIn,
      scope: token.scope,
    };
  }

  async refreshAccessToken(
    integration: TenantIntegration,
    refreshToken: string,
  ): Promise<FeishuOAuthTokenResponse> {
    const client: lark.Client = this.clients.getClient(integration);
    const token = await client.accessToken.refresh({ refreshToken });
    if (
      !token.refreshToken ||
      token.expiresIn === undefined ||
      token.expiresIn <= 0
    ) {
      throw new Error('Feishu OAuth refresh did not include metadata');
    }
    return {
      accessToken: token.accessToken,
      refreshToken: token.refreshToken,
      expiresIn: token.expiresIn,
      refreshTokenExpiresIn: token.refreshTokenExpiresIn,
      scope: token.scope,
    };
  }
}

export { FeishuOAuthApiGateway };
