import { createHash } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';

import {
  CONTROL_STORE,
  type ControlStore,
} from '@server/modules/agent-core/agent.ports';
import type {
  TenantIntegration,
} from '@server/modules/agent-core/agent.types';
import {
  IDENTITY_ACCESS_REPOSITORY,
  type IdentityAccessRepository,
} from '@server/modules/identity-access/identity-access.ports';
import type {
  PlatformMember,
} from '@server/modules/identity-access/identity-access.types';
import {
  FEISHU_OAUTH_GATEWAY,
  TOKEN_GENERATOR,
  WEB_AUTH_STORE,
  WEB_PUBLIC_URL,
  type AuthenticatedWebSession,
  type CompletedWebLogin,
  type FeishuOAuthGateway,
  type LoginStateRecord,
  type SessionRecord,
  type TokenGenerator,
  type WebAuthStore,
} from './web-auth.ports';

type WebAuthErrorCode =
  | 'ACCESS_DENIED'
  | 'INVALID_REDIRECT'
  | 'INVALID_STATE'
  | 'TENANT_MISMATCH'
  | 'UNAUTHENTICATED';

const LOGIN_STATE_TTL_MS: number = 5 * 60 * 1000;
const SESSION_TTL_MS: number = 7 * 24 * 60 * 60 * 1000;

const hashToken = (value: string): string =>
  createHash('sha256').update(value, 'utf8').digest('hex');

const formatScopedToken = (tenantId: string, random: string): string =>
  `${tenantId}.${random}`;

const parseScopedTenant = (token: string): string | null => {
  const separator: number = token.indexOf('.');
  if (separator < 1 || separator === token.length - 1) {
    return null;
  }
  const tenantId: string = token.slice(0, separator);
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu.test(
    tenantId,
  ) ? tenantId : null;
};

const normalizePublicUrl = (value: string): string => {
  const parsed: URL = new URL(value);
  if (parsed.protocol !== 'https:' && parsed.hostname !== 'localhost') {
    throw new Error('WEB_PUBLIC_URL must use HTTPS');
  }
  return parsed.origin;
};

const validateRedirectPath = (value: string): string => {
  if (
    !value.startsWith('/') ||
    value.startsWith('//') ||
    value.includes('\\')
  ) {
    throw new FeishuWebAuthError(
      'INVALID_REDIRECT',
      '登录后的页面地址无效',
    );
  }
  const parsed: URL = new URL(value, 'https://local.invalid');
  if (parsed.origin !== 'https://local.invalid') {
    throw new FeishuWebAuthError(
      'INVALID_REDIRECT',
      '登录后的页面地址无效',
    );
  }
  return `${parsed.pathname}${parsed.search}${parsed.hash}`;
};

class FeishuWebAuthError extends Error {
  constructor(
    readonly code: WebAuthErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'FeishuWebAuthError';
  }
}

@Injectable()
class FeishuWebAuthService {
  private readonly publicUrl: string;

  constructor(
    @Inject(CONTROL_STORE)
    private readonly controlStore: ControlStore,
    @Inject(IDENTITY_ACCESS_REPOSITORY)
    private readonly identities: IdentityAccessRepository,
    @Inject(WEB_AUTH_STORE)
    private readonly authStore: WebAuthStore,
    @Inject(FEISHU_OAUTH_GATEWAY)
    private readonly oauthGateway: FeishuOAuthGateway,
    @Inject(TOKEN_GENERATOR)
    private readonly tokenGenerator: TokenGenerator,
    @Inject(WEB_PUBLIC_URL)
    publicUrl: string,
  ) {
    this.publicUrl = normalizePublicUrl(publicUrl);
  }

  get publicOrigin(): string {
    return this.publicUrl;
  }

  get secureCookie(): boolean {
    return this.publicUrl.startsWith('https:');
  }

  async startLogin(
    feishuTenantKey: string,
    redirectPath: string,
    now: Date = new Date(),
  ): Promise<string> {
    const safeRedirectPath: string =
      validateRedirectPath(redirectPath);
    const integration: TenantIntegration | null =
      await this.controlStore.resolveTenant(feishuTenantKey);
    if (integration === null || integration.status !== 'active') {
      throw new FeishuWebAuthError(
        'ACCESS_DENIED',
        '无权访问当前工作区',
      );
    }

    const stateToken: string = formatScopedToken(
      integration.tenantId,
      this.tokenGenerator.generate(),
    );
    const state: LoginStateRecord = {
      stateHash: hashToken(stateToken),
      tenantId: integration.tenantId,
      redirectPath: safeRedirectPath,
      expiresAt: new Date(now.getTime() + LOGIN_STATE_TTL_MS),
    };
    await this.authStore.saveLoginState(state);

    const authorizationUrl: URL = new URL(
      'https://accounts.feishu.cn/open-apis/authen/v1/authorize',
    );
    authorizationUrl.searchParams.set('client_id', integration.appId);
    authorizationUrl.searchParams.set('response_type', 'code');
    authorizationUrl.searchParams.set(
      'redirect_uri',
      this.getCallbackUrl(),
    );
    authorizationUrl.searchParams.set('state', stateToken);
    return authorizationUrl.toString();
  }

  async completeLogin(
    code: string,
    stateToken: string,
    now: Date = new Date(),
    expectedStateToken?: string,
  ): Promise<CompletedWebLogin> {
    if (
      expectedStateToken === undefined ||
      expectedStateToken !== stateToken
    ) {
      throw new FeishuWebAuthError(
        'INVALID_STATE',
        '登录请求已失效，请重新登录',
      );
    }
    const tenantId: string | null = parseScopedTenant(stateToken);
    if (tenantId === null) {
      throw new FeishuWebAuthError(
        'INVALID_STATE',
        '登录请求已失效，请重新登录',
      );
    }
    const state: LoginStateRecord | null =
      await this.authStore.consumeLoginState(
        tenantId,
        hashToken(stateToken),
        now,
      );
    if (state === null) {
      throw new FeishuWebAuthError(
        'INVALID_STATE',
        '登录请求已失效，请重新登录',
      );
    }

    const integration: TenantIntegration | null =
      await this.resolveIntegrationForState(state);
    const identity = await this.oauthGateway.exchangeCode(
      integration,
      code,
      this.getCallbackUrl(),
    );
    if (identity.tenantKey !== integration.feishuTenantKey) {
      throw new FeishuWebAuthError(
        'TENANT_MISMATCH',
        '无权访问当前工作区',
      );
    }

    const member: PlatformMember | null =
      await this.identities.resolveMemberByOpenId(
        integration.tenantId,
        identity.openId,
      );
    if (member === null || member.status !== 'active') {
      throw new FeishuWebAuthError(
        'ACCESS_DENIED',
        '无权访问当前工作区',
      );
    }
    if (identity.displayName.trim().length > 0 &&
      identity.displayName !== member.displayName) {
      await this.identities.updateMemberDisplayName(
        integration.tenantId,
        member.id,
        identity.displayName,
      );
    }

    const sessionToken: string = formatScopedToken(
      integration.tenantId,
      this.tokenGenerator.generate(),
    );
    const expiresAt: Date = new Date(
      now.getTime() + SESSION_TTL_MS,
    );
    await this.authStore.saveSession({
      tokenHash: hashToken(sessionToken),
      tenantId: integration.tenantId,
      memberId: member.id,
      expiresAt,
    });
    return {
      sessionToken,
      redirectPath: state.redirectPath,
      expiresAt,
    };
  }

  async authenticateSession(
    sessionToken: string,
    now: Date = new Date(),
  ): Promise<AuthenticatedWebSession> {
    const tenantId: string | null = parseScopedTenant(sessionToken);
    if (tenantId === null) {
      throw new FeishuWebAuthError(
        'UNAUTHENTICATED',
        '登录状态已失效，请重新登录',
      );
    }
    const tokenHash: string = hashToken(sessionToken);
    const session: SessionRecord | null =
      await this.authStore.getSession(tenantId, tokenHash, now);
    if (session === null) {
      throw new FeishuWebAuthError(
        'UNAUTHENTICATED',
        '登录状态已失效，请重新登录',
      );
    }
    const member: PlatformMember | null =
      await this.identities.resolveMemberById(
        session.tenantId,
        session.memberId,
      );
    if (member === null || member.status !== 'active') {
      throw new FeishuWebAuthError(
        'ACCESS_DENIED',
        '无权访问当前工作区',
      );
    }
    return {
      member,
      tenantId: session.tenantId,
      tokenHash,
    };
  }

  async revokeSession(sessionToken: string): Promise<void> {
    const tenantId: string | null = parseScopedTenant(sessionToken);
    if (tenantId !== null) {
      await this.authStore.revokeSession(
        tenantId,
        hashToken(sessionToken),
      );
    }
  }

  private getCallbackUrl(): string {
    return `${this.publicUrl}/api/auth/feishu/callback`;
  }

  private async resolveIntegrationForState(
    state: LoginStateRecord,
  ): Promise<TenantIntegration> {
    const integration: TenantIntegration | null =
      await this.controlStore.resolveTenantById(state.tenantId);
    if (integration === null || integration.status !== 'active') {
      throw new FeishuWebAuthError(
        'ACCESS_DENIED',
        '无权访问当前工作区',
      );
    }
    return integration;
  }
}

export { FeishuWebAuthError, FeishuWebAuthService };
