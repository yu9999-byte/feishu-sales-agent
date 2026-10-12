import { config as loadEnvironment } from 'dotenv';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { Sql } from 'postgres';
import { PostgresFeishuUserCredentialStore } from
  '@server/modules/web-auth/postgres-feishu-user-credential.store';

loadEnvironment({ path: ['.env.local', '.env'], quiet: true });

const TENANT_A: string = '10000000-0000-4000-8000-000000000031';
const TENANT_B: string = '10000000-0000-4000-8000-000000000032';
const MEMBER_A: string = '20000000-0000-4000-8000-000000000031';
const MEMBER_B: string = '20000000-0000-4000-8000-000000000032';
const databaseUrl: string | undefined = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error('DATABASE_URL is required for credential integration tests');
}

const sql: Sql = postgres(databaseUrl, {
  max: 2,
  connect_timeout: 10,
  idle_timeout: 5,
  onnotice: (): void => undefined,
});
const store: PostgresFeishuUserCredentialStore =
  new PostgresFeishuUserCredentialStore(sql);

describe('Postgres Feishu user credential store', (): void => {
  beforeAll(async (): Promise<void> => {
    await sql`DELETE FROM agent_tenants WHERE id IN (
      ${TENANT_A}::uuid, ${TENANT_B}::uuid
    )`;
    await sql`
      INSERT INTO agent_tenants (id, feishu_tenant_key, name, status)
      VALUES
        (${TENANT_A}::uuid, 'credential-test-a', '凭据测试 A', 'active'),
        (${TENANT_B}::uuid, 'credential-test-b', '凭据测试 B', 'active')
    `;
    await sql`
      INSERT INTO tenant_members (
        tenant_id, id, feishu_open_id, display_name, status
      ) VALUES
        (${TENANT_A}::uuid, ${MEMBER_A}::uuid, 'ou_a', '销售 A', 'active'),
        (${TENANT_B}::uuid, ${MEMBER_B}::uuid, 'ou_b', '销售 B', 'active')
    `;
  });

  afterAll(async (): Promise<void> => {
    await sql`DELETE FROM agent_tenants WHERE id IN (
      ${TENANT_A}::uuid, ${TENANT_B}::uuid
    )`;
    await sql.end({ timeout: 5 });
  });

  it('isolates credentials and rotates the version on upsert', async (): Promise<void> => {
    const first = await store.saveCredential({
      tenantId: TENANT_A,
      memberId: MEMBER_A,
      accessTokenCiphertext: `v1.${'a'.repeat(48)}`,
      refreshTokenCiphertext: `v1.${'b'.repeat(48)}`,
      accessTokenExpiresAt: new Date('2026-10-13T03:00:00.000Z'),
      refreshTokenExpiresAt: new Date('2026-11-13T01:00:00.000Z'),
      scope: 'minutes:minutes:readonly',
      updatedAt: new Date('2026-10-13T01:00:00.000Z'),
    });
    expect(first.version).toBe(1);
    await expect(store.getCredential(TENANT_B, MEMBER_B)).resolves.toBeNull();

    const rotated = await store.saveCredential({
      tenantId: TENANT_A,
      memberId: MEMBER_A,
      accessTokenCiphertext: `v1.${'c'.repeat(48)}`,
      refreshTokenCiphertext: `v1.${'d'.repeat(48)}`,
      accessTokenExpiresAt: new Date('2026-10-13T05:00:00.000Z'),
      refreshTokenExpiresAt: new Date('2026-11-13T03:00:00.000Z'),
      scope: 'minutes:minutes:readonly',
      updatedAt: new Date('2026-10-13T03:00:00.000Z'),
    });
    expect(rotated).toMatchObject({
      tenantId: TENANT_A,
      memberId: MEMBER_A,
      version: 2,
      accessTokenCiphertext: `v1.${'c'.repeat(48)}`,
    });
  });
});
