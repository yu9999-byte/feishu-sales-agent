import { Inject, Injectable } from '@nestjs/common';

import type { Sql } from 'postgres';
import {
  AGENT_DATABASE,
} from '@server/modules/control-store/postgres-control.store';
import type {
  FeishuUserCredentialRecord,
  FeishuUserCredentialStore,
} from './web-auth.ports';

interface FeishuUserCredentialRow {
  tenant_id: string;
  member_id: string;
  access_token_ciphertext: string;
  refresh_token_ciphertext: string;
  access_token_expires_at: Date | string;
  refresh_token_expires_at: Date | string | null;
  scope: string | null;
  version: number;
  updated_at: Date | string;
}

const toDate = (value: Date | string): Date =>
  value instanceof Date ? value : new Date(value);

const mapRow = (
  row: FeishuUserCredentialRow,
): FeishuUserCredentialRecord => ({
  tenantId: row.tenant_id,
  memberId: row.member_id,
  accessTokenCiphertext: row.access_token_ciphertext,
  refreshTokenCiphertext: row.refresh_token_ciphertext,
  accessTokenExpiresAt: toDate(row.access_token_expires_at),
  refreshTokenExpiresAt: row.refresh_token_expires_at === null
    ? null
    : toDate(row.refresh_token_expires_at),
  scope: row.scope,
  version: row.version,
  updatedAt: toDate(row.updated_at),
});

@Injectable()
class PostgresFeishuUserCredentialStore
implements FeishuUserCredentialStore {
  constructor(
    @Inject(AGENT_DATABASE)
    private readonly sql: Sql,
  ) {}

  async getCredential(
    tenantId: string,
    memberId: string,
  ): Promise<FeishuUserCredentialRecord | null> {
    const rows: FeishuUserCredentialRow[] =
      await this.sql<FeishuUserCredentialRow[]>`
        SELECT
          tenant_id,
          member_id,
          access_token_ciphertext,
          refresh_token_ciphertext,
          access_token_expires_at,
          refresh_token_expires_at,
          scope,
          version,
          updated_at
        FROM feishu_user_credentials
        WHERE tenant_id = ${tenantId}::uuid
          AND member_id = ${memberId}::uuid
        LIMIT 1
      `;
    const row: FeishuUserCredentialRow | undefined = rows[0];
    return row === undefined ? null : mapRow(row);
  }

  async saveCredential(
    record: Omit<FeishuUserCredentialRecord, 'version'>,
  ): Promise<FeishuUserCredentialRecord> {
    const rows: FeishuUserCredentialRow[] =
      await this.sql<FeishuUserCredentialRow[]>`
        INSERT INTO feishu_user_credentials (
          tenant_id,
          member_id,
          access_token_ciphertext,
          refresh_token_ciphertext,
          access_token_expires_at,
          refresh_token_expires_at,
          scope,
          updated_at
        ) VALUES (
          ${record.tenantId}::uuid,
          ${record.memberId}::uuid,
          ${record.accessTokenCiphertext},
          ${record.refreshTokenCiphertext},
          ${record.accessTokenExpiresAt},
          ${record.refreshTokenExpiresAt},
          ${record.scope},
          ${record.updatedAt}
        )
        ON CONFLICT (tenant_id, member_id) DO UPDATE SET
          access_token_ciphertext = EXCLUDED.access_token_ciphertext,
          refresh_token_ciphertext = EXCLUDED.refresh_token_ciphertext,
          access_token_expires_at = EXCLUDED.access_token_expires_at,
          refresh_token_expires_at = EXCLUDED.refresh_token_expires_at,
          scope = EXCLUDED.scope,
          version = feishu_user_credentials.version + 1,
          updated_at = EXCLUDED.updated_at
        RETURNING
          tenant_id,
          member_id,
          access_token_ciphertext,
          refresh_token_ciphertext,
          access_token_expires_at,
          refresh_token_expires_at,
          scope,
          version,
          updated_at
      `;
    const row: FeishuUserCredentialRow | undefined = rows[0];
    if (row === undefined) {
      throw new Error('Feishu user credential upsert returned no row');
    }
    return mapRow(row);
  }
}

export { PostgresFeishuUserCredentialStore };
