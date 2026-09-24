import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import {
  FeishuWebAuthError,
  FeishuWebAuthService,
} from '@server/modules/web-auth/feishu-web-auth.service';
import type {
  FeishuOAuthGateway,
  FeishuOAuthIdentity,
  LoginStateRecord,
  SessionRecord,
  TokenGenerator,
  WebAuthStore,
} from '@server/modules/web-auth/web-auth.ports';
import type {
  ControlStore,
} from '@server/modules/agent-core/agent.ports';
import type {
  IdentityAccessRepository,
  PlatformTenant,
} from '@server/modules/identity-access/identity-access.ports';
import type {
  PlatformMember,
  ReportingRelation,
  ResourceGrant,
  RoleAssignment,
} from '@server/modules/identity-access/identity-access.types';
import type {
  AgentExecutionResult,
  PendingActionStatus,
} from '@shared/api.interface';
import type {
  AgentSession,
  AuditEventInput,
  CreatePendingActionInput,
  PendingAction,
  SaveCollectingSessionInput,
  SaveIntentClarificationSessionInput,
  TenantIntegration,
} from '@server/modules/agent-core/agent.types';

const TENANT_ID: string = '00000000-0000-4000-8000-00000000000a';
const TENANT_KEY: string = 'tenant-a';
const NOW: Date = new Date('2026-09-19T12:00:00+08:00');
const STATE_RANDOM: string = 'state-token-with-enough-entropy';
const SESSION_RANDOM: string = 'session-token-with-enough-entropy';
const STATE_TOKEN: string = `${TENANT_ID}.${STATE_RANDOM}`;
const SESSION_TOKEN: string = `${TENANT_ID}.${SESSION_RANDOM}`;

const hashToken = (value: string): string =>
  createHash('sha256').update(value, 'utf8').digest('hex');

const integration: TenantIntegration = {
  tenantId: TENANT_ID,
  feishuTenantKey: TENANT_KEY,
  name: '华东示范企业',
  status: 'active',
  appId: 'cli_test_app',
  appSecretEnv: 'TEST_APP_SECRET',
  appType: 'selfBuild',
  base: {
    appToken: 'base_test',
    customers: {
      tableId: 'customers',
      primaryField: '客户名称',
      fields: { customerName: '客户名称' },
    },
    opportunities: {
      tableId: 'opportunities',
      primaryField: '商机名称',
      fields: {
        opportunityName: '商机名称',
        customerLink: '关联客户',
      },
    },
    followups: {
      tableId: 'followups',
      primaryField: '跟进标题',
      fields: {
        sourceMessageId: '来源消息ID',
        customerLink: '关联客户',
        opportunityLink: '关联商机',
        rawText: '原文',
        summary: '摘要',
      },
    },
  },
};

class FakeControlStore implements ControlStore {
  async resolveTenant(
    feishuTenantKey: string,
  ): Promise<TenantIntegration | null> {
    return feishuTenantKey === TENANT_KEY
      ? structuredClone(integration)
      : null;
  }

  async resolveTenantById(
    tenantId: string,
  ): Promise<TenantIntegration | null> {
    return tenantId === TENANT_ID
      ? structuredClone(integration)
      : null;
  }

  async claimMessage(): Promise<boolean> {
    throw new Error('not used');
  }

  async getOpenSession(): Promise<AgentSession | null> {
    throw new Error('not used');
  }

  async saveCollectingSession(
    _input: SaveCollectingSessionInput,
  ): Promise<AgentSession> {
    throw new Error('not used');
  }

  async saveIntentClarificationSession(
    _input: SaveIntentClarificationSessionInput,
  ): Promise<AgentSession> {
    throw new Error('not used');
  }

  async closeSession(): Promise<void> {
    throw new Error('not used');
  }

  async createPendingAction(
    _input: CreatePendingActionInput,
  ): Promise<PendingAction> {
    throw new Error('not used');
  }

  async setPendingCardMessage(): Promise<void> {
    throw new Error('not used');
  }

  async getPendingAction(): Promise<PendingAction | null> {
    throw new Error('not used');
  }

  async acquirePendingAction(): Promise<PendingAction | null> {
    throw new Error('not used');
  }

  async cancelPendingAction(): Promise<PendingAction | null> {
    throw new Error('not used');
  }

  async saveExecutionResult(
    _tenantId: string,
    _actionId: string,
    _status: PendingActionStatus,
    _result: AgentExecutionResult,
  ): Promise<PendingAction> {
    throw new Error('not used');
  }

  async appendAudit(_event: AuditEventInput): Promise<void> {
    throw new Error('not used');
  }
}

class FakeIdentityRepository implements IdentityAccessRepository {
  updatedDisplayName: string | null = null;
  member: PlatformMember | null = {
    id: 'member-current',
    tenantId: TENANT_ID,
    feishuOpenId: 'ou_current',
    displayName: '季然',
    status: 'active',
  };

  async resolveTenantById(
    tenantId: string,
  ): Promise<PlatformTenant | null> {
    return tenantId === TENANT_ID
      ? {
          id: TENANT_ID,
          feishuTenantKey: TENANT_KEY,
          name: '华东示范企业',
          timezone: 'Asia/Shanghai',
          status: 'active',
        }
      : null;
  }

  async resolveTenantByFeishuKey(
    feishuTenantKey: string,
  ): Promise<PlatformTenant | null> {
    return feishuTenantKey === TENANT_KEY
      ? {
          id: TENANT_ID,
          feishuTenantKey: TENANT_KEY,
          name: '华东示范企业',
          timezone: 'Asia/Shanghai',
          status: 'active',
        }
      : null;
  }

  async resolveMemberByOpenId(
    tenantId: string,
    feishuOpenId: string,
  ): Promise<PlatformMember | null> {
    if (
      this.member?.tenantId !== tenantId ||
      this.member.feishuOpenId !== feishuOpenId
    ) {
      return null;
    }
    return structuredClone(this.member);
  }

  async resolveMemberById(
    tenantId: string,
    memberId: string,
  ): Promise<PlatformMember | null> {
    if (
      this.member?.tenantId !== tenantId ||
      this.member.id !== memberId
    ) {
      return null;
    }
    return structuredClone(this.member);
  }

  async updateMemberDisplayName(
    _tenantId: string,
    _memberId: string,
    displayName: string,
  ): Promise<void> {
    this.updatedDisplayName = displayName;
    if (this.member !== null) {
      this.member.displayName = displayName;
    }
  }

  async listMembers(): Promise<PlatformMember[]> {
    return this.member === null ? [] : [structuredClone(this.member)];
  }

  async listRoleAssignments(): Promise<RoleAssignment[]> {
    return [];
  }

  async listReportingRelations(): Promise<ReportingRelation[]> {
    return [];
  }

  async listResourceGrants(): Promise<ResourceGrant[]> {
    return [];
  }
}

class FakeWebAuthStore implements WebAuthStore {
  state: LoginStateRecord | null = null;
  session: SessionRecord | null = null;

  async saveLoginState(record: LoginStateRecord): Promise<void> {
    this.state = structuredClone(record);
  }

  async consumeLoginState(
    tenantId: string,
    stateHash: string,
    now: Date,
  ): Promise<LoginStateRecord | null> {
    if (
      this.state === null ||
      this.state.tenantId !== tenantId ||
      this.state.stateHash !== stateHash ||
      this.state.expiresAt.getTime() <= now.getTime()
    ) {
      return null;
    }
    const consumed: LoginStateRecord = structuredClone(this.state);
    this.state = null;
    return consumed;
  }

  async saveSession(record: SessionRecord): Promise<void> {
    this.session = structuredClone(record);
  }

  async getSession(
    tenantId: string,
    tokenHash: string,
    now: Date,
  ): Promise<SessionRecord | null> {
    if (
      this.session === null ||
      this.session.tenantId !== tenantId ||
      this.session.tokenHash !== tokenHash ||
      this.session.expiresAt.getTime() <= now.getTime()
    ) {
      return null;
    }
    return structuredClone(this.session);
  }

  async revokeSession(
    _tenantId: string,
    _tokenHash: string,
  ): Promise<void> {
    this.session = null;
  }
}

class FakeOAuthGateway implements FeishuOAuthGateway {
  identity: FeishuOAuthIdentity = {
    tenantKey: TENANT_KEY,
    openId: 'ou_current',
    displayName: '季然',
  };

  async exchangeCode(): Promise<FeishuOAuthIdentity> {
    return structuredClone(this.identity);
  }
}

class FixedTokenGenerator implements TokenGenerator {
  private index: number = 0;

  generate(): string {
    const values: string[] = [STATE_RANDOM, SESSION_RANDOM];
    const value: string | undefined = values[this.index];
    this.index += 1;
    if (value === undefined) {
      throw new Error('No more fixed tokens');
    }
    return value;
  }
}

interface Harness {
  service: FeishuWebAuthService;
  identities: FakeIdentityRepository;
  oauth: FakeOAuthGateway;
  store: FakeWebAuthStore;
}

const createHarness = (): Harness => {
  const identities: FakeIdentityRepository =
    new FakeIdentityRepository();
  const oauth: FakeOAuthGateway = new FakeOAuthGateway();
  const store: FakeWebAuthStore = new FakeWebAuthStore();
  const service: FeishuWebAuthService = new FeishuWebAuthService(
    new FakeControlStore(),
    identities,
    store,
    oauth,
    new FixedTokenGenerator(),
    'https://agent.example.com',
  );
  return { service, identities, oauth, store };
};

describe('FeishuWebAuthService', (): void => {
  it('creates an official authorization URL and stores only a state hash', async (): Promise<void> => {
    const harness: Harness = createHarness();
    const url: string = await harness.service.startLogin(
      TENANT_KEY,
      '/customers',
      NOW,
    );
    const parsed: URL = new URL(url);

    expect(parsed.origin + parsed.pathname).toBe(
      'https://accounts.feishu.cn/open-apis/authen/v1/authorize',
    );
    expect(parsed.searchParams.get('client_id')).toBe('cli_test_app');
    expect(parsed.searchParams.get('response_type')).toBe('code');
    expect(parsed.searchParams.get('redirect_uri')).toBe(
      'https://agent.example.com/api/auth/feishu/callback',
    );
    expect(parsed.searchParams.get('state')).toBe(STATE_TOKEN);
    expect(parsed.searchParams.has('scope')).toBe(false);
    expect(harness.store.state?.stateHash).toBe(hashToken(STATE_TOKEN));
    expect(JSON.stringify(harness.store.state)).not.toContain(STATE_TOKEN);
  });

  it('rejects an external redirect path', async (): Promise<void> => {
    const harness: Harness = createHarness();

    await expect(
      harness.service.startLogin(
        TENANT_KEY,
        'https://evil.example/path',
        NOW,
      ),
    ).rejects.toMatchObject({ code: 'INVALID_REDIRECT' });
  });

  it('rejects an invalid or replayed state before code exchange', async (): Promise<void> => {
    const harness: Harness = createHarness();

    await expect(
      harness.service.completeLogin('code-1', 'wrong-state', NOW),
    ).rejects.toBeInstanceOf(FeishuWebAuthError);

    await harness.service.startLogin(TENANT_KEY, '/', NOW);
    await expect(
      harness.service.completeLogin(
        'code-cookie-mismatch',
        STATE_TOKEN,
        NOW,
        `${TENANT_ID}.different-browser-state`,
      ),
    ).rejects.toMatchObject({ code: 'INVALID_STATE' });
    expect(harness.store.state).not.toBeNull();

    await harness.service.completeLogin('code-1', STATE_TOKEN, NOW);
    await expect(
      harness.service.completeLogin('code-2', STATE_TOKEN, NOW),
    ).rejects.toMatchObject({ code: 'INVALID_STATE' });
  });

  it('rejects a tenant mismatch returned by Feishu', async (): Promise<void> => {
    const harness: Harness = createHarness();
    harness.oauth.identity.tenantKey = 'tenant-b';
    await harness.service.startLogin(TENANT_KEY, '/', NOW);

    await expect(
      harness.service.completeLogin('code-1', STATE_TOKEN, NOW),
    ).rejects.toMatchObject({ code: 'TENANT_MISMATCH' });
  });

  it('rejects a Feishu user without an active tenant membership', async (): Promise<void> => {
    const harness: Harness = createHarness();
    harness.identities.member = null;
    await harness.service.startLogin(TENANT_KEY, '/', NOW);

    await expect(
      harness.service.completeLogin('code-1', STATE_TOKEN, NOW),
    ).rejects.toMatchObject({ code: 'ACCESS_DENIED' });
  });

  it('issues an opaque session while persisting only its hash', async (): Promise<void> => {
    const harness: Harness = createHarness();
    if (harness.identities.member !== null) {
      harness.identities.member.displayName = '待同步姓名';
    }
    await harness.service.startLogin(TENANT_KEY, '/analytics', NOW);
    const completed = await harness.service.completeLogin(
      'code-1',
      STATE_TOKEN,
      NOW,
    );

    expect(completed).toEqual({
      sessionToken: SESSION_TOKEN,
      redirectPath: '/analytics',
      expiresAt: new Date('2026-09-26T04:00:00.000Z'),
    });
    expect(harness.store.session).toMatchObject({
      tenantId: TENANT_ID,
      memberId: 'member-current',
      tokenHash: hashToken(SESSION_TOKEN),
    });
    expect(JSON.stringify(harness.store.session)).not.toContain(
      SESSION_TOKEN,
    );
    expect(harness.identities.updatedDisplayName).toBe('季然');
  });
});
