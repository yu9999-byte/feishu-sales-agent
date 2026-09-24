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

interface FeishuOAuthGateway {
  exchangeCode(
    integration: TenantIntegration,
    code: string,
    redirectUri: string,
  ): Promise<FeishuOAuthIdentity>;
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
const FEISHU_OAUTH_GATEWAY = Symbol('FEISHU_OAUTH_GATEWAY');
const TOKEN_GENERATOR = Symbol('TOKEN_GENERATOR');
const WEB_PUBLIC_URL = Symbol('WEB_PUBLIC_URL');

export {
  FEISHU_OAUTH_GATEWAY,
  TOKEN_GENERATOR,
  WEB_AUTH_STORE,
  WEB_PUBLIC_URL,
};

export type {
  AuthenticatedWebSession,
  CompletedWebLogin,
  FeishuOAuthGateway,
  FeishuOAuthIdentity,
  LoginStateRecord,
  SessionRecord,
  TokenGenerator,
  WebAuthStore,
};
