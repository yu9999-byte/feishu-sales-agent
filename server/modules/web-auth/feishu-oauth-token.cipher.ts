import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from 'node:crypto';

import type { TenantIntegration } from
  '@server/modules/agent-core/agent.types';

type FeishuOAuthTokenKind = 'access' | 'refresh';

const ENCRYPTION_VERSION: string = 'v1';

class FeishuOAuthTokenCipher {
  encrypt(
    integration: TenantIntegration,
    memberId: string,
    kind: FeishuOAuthTokenKind,
    plaintext: string,
  ): string {
    if (plaintext.length === 0) {
      throw new Error('OAuth token cannot be empty');
    }
    const iv: Buffer = randomBytes(12);
    const cipher = createCipheriv(
      'aes-256-gcm',
      this.deriveKey(integration),
      iv,
    );
    cipher.setAAD(Buffer.from(this.aad(integration, memberId, kind), 'utf8'));
    const encrypted: Buffer = Buffer.concat([
      cipher.update(plaintext, 'utf8'),
      cipher.final(),
    ]);
    const tag: Buffer = cipher.getAuthTag();
    return [
      ENCRYPTION_VERSION,
      iv.toString('base64url'),
      tag.toString('base64url'),
      encrypted.toString('base64url'),
    ].join('.');
  }

  decrypt(
    integration: TenantIntegration,
    memberId: string,
    kind: FeishuOAuthTokenKind,
    ciphertext: string,
  ): string {
    const parts: string[] = ciphertext.split('.');
    if (parts.length !== 4 || parts[0] !== ENCRYPTION_VERSION) {
      throw new Error('Unsupported OAuth credential ciphertext');
    }
    const iv: Buffer = Buffer.from(parts[1] ?? '', 'base64url');
    const tag: Buffer = Buffer.from(parts[2] ?? '', 'base64url');
    const encrypted: Buffer = Buffer.from(parts[3] ?? '', 'base64url');
    if (iv.length !== 12 || tag.length !== 16 || encrypted.length === 0) {
      throw new Error('Invalid OAuth credential ciphertext');
    }
    const decipher = createDecipheriv(
      'aes-256-gcm',
      this.deriveKey(integration),
      iv,
    );
    decipher.setAAD(
      Buffer.from(this.aad(integration, memberId, kind), 'utf8'),
    );
    decipher.setAuthTag(tag);
    return Buffer.concat([
      decipher.update(encrypted),
      decipher.final(),
    ]).toString('utf8');
  }

  private deriveKey(integration: TenantIntegration): Buffer {
    const appSecret: string | undefined =
      process.env[integration.appSecretEnv];
    if (!appSecret) {
      throw new Error('Feishu app secret is unavailable for OAuth storage');
    }
    return createHash('sha256')
      .update('sales-agent-feishu-user-oauth-v1', 'utf8')
      .update('\0', 'utf8')
      .update(integration.tenantId, 'utf8')
      .update('\0', 'utf8')
      .update(integration.appId, 'utf8')
      .update('\0', 'utf8')
      .update(appSecret, 'utf8')
      .digest();
  }

  private aad(
    integration: TenantIntegration,
    memberId: string,
    kind: FeishuOAuthTokenKind,
  ): string {
    return [
      ENCRYPTION_VERSION,
      integration.tenantId,
      integration.appId,
      memberId,
      kind,
    ].join(':');
  }
}

export { FeishuOAuthTokenCipher };
export type { FeishuOAuthTokenKind };
