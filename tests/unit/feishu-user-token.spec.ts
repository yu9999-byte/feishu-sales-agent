import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { TenantIntegration } from
  '@server/modules/agent-core/agent.types';
import {
  FeishuOAuthTokenCipher,
} from '@server/modules/web-auth/feishu-oauth-token.cipher';
import {
  FeishuUserTokenError,
  FeishuUserTokenService,
} from '@server/modules/web-auth/feishu-user-token.service';
import type {
  FeishuOAuthGateway,
  FeishuOAuthGrant,
  FeishuOAuthTokenResponse,
  FeishuUserCredentialRecord,
  FeishuUserCredentialStore,
} from '@server/modules/web-auth/web-auth.ports';

const TENANT_ID: string = '00000000-0000-4000-8000-00000000000a';
const MEMBER_ID: string = '00000000-0000-4000-8000-00000000000b';
const NOW: Date = new Date('2026-10-13T01:00:00.000Z');
const SECRET_ENV: string = 'TEST_USER_TOKEN_APP_SECRET';

const integration: TenantIntegration = {
  tenantId: TENANT_ID,
  feishuTenantKey: 'tenant-a',
  name: '华东示范企业',
  status: 'active',
  appId: 'cli_test',
  appSecretEnv: SECRET_ENV,
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

class MemoryCredentialStore implements FeishuUserCredentialStore {
  records: Map<string, FeishuUserCredentialRecord> = new Map();

  async getCredential(
    tenantId: string,
    memberId: string,
  ): Promise<FeishuUserCredentialRecord | null> {
    const value: FeishuUserCredentialRecord | undefined =
      this.records.get(`${tenantId}:${memberId}`);
    return value === undefined ? null : structuredClone(value);
  }

  async saveCredential(
    record: Omit<FeishuUserCredentialRecord, 'version'>,
  ): Promise<FeishuUserCredentialRecord> {
    const key: string = `${record.tenantId}:${record.memberId}`;
    const previous: FeishuUserCredentialRecord | undefined =
      this.records.get(key);
    const saved: FeishuUserCredentialRecord = {
      ...structuredClone(record),
      version: (previous?.version ?? 0) + 1,
    };
    this.records.set(key, saved);
    return structuredClone(saved);
  }
}

class FakeOAuthGateway implements FeishuOAuthGateway {
  refreshCalls: string[] = [];
  refreshed: FeishuOAuthTokenResponse = {
    accessToken: 'uat-refreshed',
    refreshToken: 'urt-refreshed',
    expiresIn: 7200,
    refreshTokenExpiresIn: 2_592_000,
    scope: 'minutes:minutes:readonly',
  };

  async exchangeCode(): Promise<FeishuOAuthGrant> {
    throw new Error('not used');
  }

  async refreshAccessToken(
    _integration: TenantIntegration,
    refreshToken: string,
  ): Promise<FeishuOAuthTokenResponse> {
    this.refreshCalls.push(refreshToken);
    return structuredClone(this.refreshed);
  }
}

const grant: FeishuOAuthGrant = {
  tenantKey: 'tenant-a',
  openId: 'ou_sales',
  displayName: '季然',
  accessToken: 'uat-original',
  refreshToken: 'urt-original',
  expiresIn: 7200,
  refreshTokenExpiresIn: 2_592_000,
  scope: 'minutes:minutes:readonly',
};

describe('FeishuUserTokenService', (): void => {
  beforeEach((): void => {
    process.env[SECRET_ENV] = 'test-app-secret-with-enough-entropy';
  });

  afterEach((): void => {
    delete process.env[SECRET_ENV];
  });

  it('stores only authenticated ciphertext for a tenant member', async (): Promise<void> => {
    const store: MemoryCredentialStore = new MemoryCredentialStore();
    const service: FeishuUserTokenService = new FeishuUserTokenService(
      store,
      new FakeOAuthGateway(),
      new FeishuOAuthTokenCipher(),
    );

    await service.saveAuthorization(integration, MEMBER_ID, grant, NOW);
    const persisted: FeishuUserCredentialRecord | undefined =
      store.records.get(`${TENANT_ID}:${MEMBER_ID}`);

    expect(persisted).toMatchObject({
      tenantId: TENANT_ID,
      memberId: MEMBER_ID,
      version: 1,
      accessTokenExpiresAt: new Date('2026-10-13T03:00:00.000Z'),
    });
    expect(JSON.stringify(persisted)).not.toContain('uat-original');
    expect(JSON.stringify(persisted)).not.toContain('urt-original');
    await expect(service.getValidAccessToken(
      integration,
      MEMBER_ID,
      new Date('2026-10-13T01:30:00.000Z'),
    )).resolves.toBe('uat-original');
  });

  it('refreshes a near-expiry token and rotates both ciphertexts', async (): Promise<void> => {
    const store: MemoryCredentialStore = new MemoryCredentialStore();
    const oauth: FakeOAuthGateway = new FakeOAuthGateway();
    const service: FeishuUserTokenService = new FeishuUserTokenService(
      store,
      oauth,
      new FeishuOAuthTokenCipher(),
    );
    await service.saveAuthorization(
      integration,
      MEMBER_ID,
      { ...grant, expiresIn: 30 },
      NOW,
    );

    await expect(service.getValidAccessToken(
      integration,
      MEMBER_ID,
      new Date('2026-10-13T01:00:10.000Z'),
    )).resolves.toBe('uat-refreshed');
    expect(oauth.refreshCalls).toEqual(['urt-original']);
    expect(store.records.get(`${TENANT_ID}:${MEMBER_ID}`)?.version).toBe(2);
    const persistedValues: string = JSON.stringify(
      Array.from(store.records.values()),
    );
    expect(persistedValues).not.toContain('uat-refreshed');
    expect(persistedValues).not.toContain('urt-refreshed');
  });

  it('fails closed for a different tenant or member', async (): Promise<void> => {
    const store: MemoryCredentialStore = new MemoryCredentialStore();
    const service: FeishuUserTokenService = new FeishuUserTokenService(
      store,
      new FakeOAuthGateway(),
      new FeishuOAuthTokenCipher(),
    );
    await service.saveAuthorization(integration, MEMBER_ID, grant, NOW);

    await expect(service.getValidAccessToken(
      integration,
      '00000000-0000-4000-8000-00000000000c',
      NOW,
    )).rejects.toBeInstanceOf(FeishuUserTokenError);
    const otherTenant: TenantIntegration = {
      ...integration,
      tenantId: '00000000-0000-4000-8000-00000000000d',
    };
    await expect(service.getValidAccessToken(
      otherTenant,
      MEMBER_ID,
      NOW,
    )).rejects.toMatchObject({ code: 'AUTHORIZATION_REQUIRED' });
  });

  it('requires the user grant to include a minutes read scope', async (): Promise<void> => {
    const store: MemoryCredentialStore = new MemoryCredentialStore();
    const service: FeishuUserTokenService = new FeishuUserTokenService(
      store,
      new FakeOAuthGateway(),
      new FeishuOAuthTokenCipher(),
    );
    await service.saveAuthorization(
      integration,
      MEMBER_ID,
      { ...grant, scope: 'auth:user.id:read' },
      NOW,
    );

    await expect(service.getValidAccessToken(
      integration,
      MEMBER_ID,
      NOW,
    )).rejects.toMatchObject({ code: 'AUTHORIZATION_REQUIRED' });
  });
});
