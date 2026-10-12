import { Inject, Injectable } from '@nestjs/common';

import type { TenantIntegration } from
  '@server/modules/agent-core/agent.types';
import { FeishuOAuthTokenCipher } from './feishu-oauth-token.cipher';
import {
  FEISHU_OAUTH_GATEWAY,
  FEISHU_USER_CREDENTIAL_STORE,
  type FeishuOAuthGateway,
  type FeishuOAuthGrant,
  type FeishuOAuthTokenResponse,
  type FeishuUserCredentialRecord,
  type FeishuUserCredentialStore,
} from './web-auth.ports';

interface FeishuUserTokenProvider {
  getValidAccessToken(
    integration: TenantIntegration,
    memberId: string,
    now: Date,
  ): Promise<string | null>;
}

type FeishuUserTokenErrorCode =
  | 'AUTHORIZATION_REQUIRED'
  | 'AUTHORIZATION_UNAVAILABLE';

class FeishuUserTokenError extends Error {
  constructor(
    readonly code: FeishuUserTokenErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'FeishuUserTokenError';
  }
}

const REFRESH_SKEW_MS: number = 60_000;
const MINUTES_READ_SCOPES: string[] = [
  'minutes:minutes',
  'minutes:minutes:readonly',
];

@Injectable()
class FeishuUserTokenService implements FeishuUserTokenProvider {
  constructor(
    @Inject(FEISHU_USER_CREDENTIAL_STORE)
    private readonly store: FeishuUserCredentialStore,
    @Inject(FEISHU_OAUTH_GATEWAY)
    private readonly oauth: FeishuOAuthGateway,
    private readonly cipher: FeishuOAuthTokenCipher,
  ) {}

  async saveAuthorization(
    integration: TenantIntegration,
    memberId: string,
    grant: FeishuOAuthGrant,
    now: Date,
  ): Promise<void> {
    await this.saveTokens(integration, memberId, grant, now);
  }

  async getValidAccessToken(
    integration: TenantIntegration,
    memberId: string,
    now: Date,
  ): Promise<string | null> {
    const record: FeishuUserCredentialRecord | null =
      await this.store.getCredential(integration.tenantId, memberId);
    if (record === null) {
      throw new FeishuUserTokenError(
        'AUTHORIZATION_REQUIRED',
        '飞书用户授权尚未完成',
      );
    }
    if (
      record.scope !== null &&
      !this.hasMinutesReadScope(record.scope)
    ) {
      throw new FeishuUserTokenError(
        'AUTHORIZATION_REQUIRED',
        '飞书用户授权缺少妙记读取权限',
      );
    }
    if (record.accessTokenExpiresAt.getTime() >
      now.getTime() + REFRESH_SKEW_MS) {
      return this.cipher.decrypt(
        integration,
        memberId,
        'access',
        record.accessTokenCiphertext,
      );
    }
    if (
      record.refreshTokenExpiresAt !== null &&
      record.refreshTokenExpiresAt.getTime() <= now.getTime()
    ) {
      throw new FeishuUserTokenError(
        'AUTHORIZATION_REQUIRED',
        '飞书用户授权已过期',
      );
    }

    let refreshed: FeishuOAuthTokenResponse;
    try {
      const refreshToken: string = this.cipher.decrypt(
        integration,
        memberId,
        'refresh',
        record.refreshTokenCiphertext,
      );
      refreshed = await this.oauth.refreshAccessToken(
        integration,
        refreshToken,
      );
    } catch (error: unknown) {
      if (error instanceof FeishuUserTokenError) throw error;
      throw new FeishuUserTokenError(
        'AUTHORIZATION_UNAVAILABLE',
        '飞书用户授权刷新暂时不可用',
      );
    }
    await this.saveTokens(integration, memberId, refreshed, now);
    return refreshed.accessToken;
  }

  private async saveTokens(
    integration: TenantIntegration,
    memberId: string,
    tokens: FeishuOAuthTokenResponse,
    now: Date,
  ): Promise<void> {
    if (
      tokens.accessToken.length === 0 ||
      tokens.refreshToken.length === 0 ||
      !Number.isFinite(tokens.expiresIn) ||
      tokens.expiresIn <= 0
    ) {
      throw new FeishuUserTokenError(
        'AUTHORIZATION_UNAVAILABLE',
        '飞书用户授权响应无效',
      );
    }
    const refreshTokenExpiresAt: Date | null =
      tokens.refreshTokenExpiresIn !== undefined &&
      Number.isFinite(tokens.refreshTokenExpiresIn) &&
      tokens.refreshTokenExpiresIn > 0
        ? new Date(
          now.getTime() + tokens.refreshTokenExpiresIn * 1000,
        )
        : null;
    await this.store.saveCredential({
      tenantId: integration.tenantId,
      memberId,
      accessTokenCiphertext: this.cipher.encrypt(
        integration,
        memberId,
        'access',
        tokens.accessToken,
      ),
      refreshTokenCiphertext: this.cipher.encrypt(
        integration,
        memberId,
        'refresh',
        tokens.refreshToken,
      ),
      accessTokenExpiresAt: new Date(
        now.getTime() + tokens.expiresIn * 1000,
      ),
      refreshTokenExpiresAt,
      scope: tokens.scope?.trim() || null,
      updatedAt: now,
    });
  }

  private hasMinutesReadScope(scope: string): boolean {
    const values: Set<string> = new Set(
      scope.split(/[\s,]+/u).filter(
        (value: string): boolean => value.length > 0,
      ),
    );
    return MINUTES_READ_SCOPES.some(
      (value: string): boolean => values.has(value),
    );
  }
}

const FEISHU_USER_TOKEN_PROVIDER = Symbol('FEISHU_USER_TOKEN_PROVIDER');

export {
  FEISHU_USER_TOKEN_PROVIDER,
  FeishuUserTokenError,
  FeishuUserTokenService,
};
export type {
  FeishuUserTokenErrorCode,
  FeishuUserTokenProvider,
};
