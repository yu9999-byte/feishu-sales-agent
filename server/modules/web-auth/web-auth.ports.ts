import type {
  PlatformMember,
} from '@server/modules/identity-access/identity-access.types';
import type {
  TenantIntegration,
} from '@server/modules/agent-core/agent.types';

interface LoginStateRecord {
  stateHash: string;
  tenantId: string;
  redirectPath: string;
  expiresAt: Date;
}

interface SessionRecord {
  tokenHash: string;
  tenantId: string;
  memberId: string;
  expiresAt: Date;
}

interface WebAuthStore {
  saveLoginState(record: LoginStateRecord): Promise<void>;
  consumeLoginState(
    tenantId: string,
    stateHash: string,
    now: Date,
  ): Promise<LoginStateRecord | null>;
  saveSession(record: SessionRecord): Promise<void>;
  getSession(
    tenantId: string,
    tokenHash: string,
    now: Date,
  ): Promise<SessionRecord | null>;
  revokeSession(tenantId: string, tokenHash: string): Promise<void>;
}

interface FeishuOAuthIdentity {
  tenantKey: string;
  openId: string;
  displayName: string;
}

interface FeishuOAuthTokenResponse {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  refreshTokenExpiresIn?: number;
  scope?: string;
}

interface FeishuOAuthGrant extends FeishuOAuthIdentity,
  FeishuOAuthTokenResponse {}

interface FeishuOAuthGateway {
  exchangeCode(
    integration: TenantIntegration,
    code: string,
    redirectUri: string,
  ): Promise<FeishuOAuthGrant>;
  refreshAccessToken(
    integration: TenantIntegration,
    refreshToken: string,
  ): Promise<FeishuOAuthTokenResponse>;
}

interface FeishuUserCredentialRecord {
  tenantId: string;
  memberId: string;
  accessTokenCiphertext: string;
  refreshTokenCiphertext: string;
  accessTokenExpiresAt: Date;
  refreshTokenExpiresAt: Date | null;
  scope: string | null;
  version: number;
  updatedAt: Date;
}

interface FeishuUserCredentialStore {
  getCredential(
    tenantId: string,
    memberId: string,
  ): Promise<FeishuUserCredentialRecord | null>;
  saveCredential(
    record: Omit<FeishuUserCredentialRecord, 'version'>,
  ): Promise<FeishuUserCredentialRecord>;
}

interface TokenGenerator {
  generate(): string;
}

interface CompletedWebLogin {
  sessionToken: string;
  redirectPath: string;
  expiresAt: Date;
}

interface AuthenticatedWebSession {
  member: PlatformMember;
  tenantId: string;
  tokenHash: string;
}

const WEB_AUTH_STORE = Symbol('WEB_AUTH_STORE');
const FEISHU_USER_CREDENTIAL_STORE = Symbol(
  'FEISHU_USER_CREDENTIAL_STORE',
);
const FEISHU_OAUTH_GATEWAY = Symbol('FEISHU_OAUTH_GATEWAY');
const TOKEN_GENERATOR = Symbol('TOKEN_GENERATOR');
const WEB_PUBLIC_URL = Symbol('WEB_PUBLIC_URL');

export {
  FEISHU_OAUTH_GATEWAY,
  FEISHU_USER_CREDENTIAL_STORE,
  TOKEN_GENERATOR,
  WEB_AUTH_STORE,
  WEB_PUBLIC_URL,
};

export type {
  AuthenticatedWebSession,
  CompletedWebLogin,
  FeishuOAuthGateway,
  FeishuOAuthGrant,
  FeishuOAuthIdentity,
  FeishuOAuthTokenResponse,
  FeishuUserCredentialRecord,
  FeishuUserCredentialStore,
  LoginStateRecord,
  SessionRecord,
  TokenGenerator,
  WebAuthStore,
};
