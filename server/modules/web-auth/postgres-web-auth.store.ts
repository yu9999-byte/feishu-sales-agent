import { Inject, Injectable } from '@nestjs/common';

import type { Sql } from 'postgres';
import {
  AGENT_DATABASE,
} from '@server/modules/control-store/postgres-control.store';
import type {
  LoginStateRecord,
  SessionRecord,
  WebAuthStore,
} from './web-auth.ports';

interface LoginStateRow {
  state_hash: string;
  tenant_id: string;
  redirect_path: string;
  expires_at: Date | string;
}

interface SessionRow {
  token_hash: string;
  tenant_id: string;
  member_id: string;
  expires_at: Date | string;
}

const toDate = (value: Date | string): Date =>
  value instanceof Date ? value : new Date(value);

@Injectable()
class PostgresWebAuthStore implements WebAuthStore {
  constructor(
    @Inject(AGENT_DATABASE)
    private readonly sql: Sql,
  ) {}

  async saveLoginState(record: LoginStateRecord): Promise<void> {
    await this.sql`
      INSERT INTO web_login_states (
        tenant_id,
        state_hash,
        redirect_path,
        expires_at
      ) VALUES (
        ${record.tenantId}::uuid,
        ${record.stateHash},
        ${record.redirectPath},
        ${record.expiresAt}
      )
    `;
  }

  async consumeLoginState(
    tenantId: string,
    stateHash: string,
    now: Date,
  ): Promise<LoginStateRecord | null> {
    const rows: LoginStateRow[] = await this.sql<LoginStateRow[]>`
      UPDATE web_login_states
      SET consumed_at = ${now}
      WHERE tenant_id = ${tenantId}::uuid
        AND state_hash = ${stateHash}
        AND consumed_at IS NULL
        AND expires_at > ${now}
      RETURNING state_hash, tenant_id, redirect_path, expires_at
    `;
    const row: LoginStateRow | undefined = rows[0];
    if (row === undefined) {
      return null;
    }
    return {
      stateHash: row.state_hash,
      tenantId: row.tenant_id,
      redirectPath: row.redirect_path,
      expiresAt: toDate(row.expires_at),
    };
  }

  async saveSession(record: SessionRecord): Promise<void> {
    await this.sql`
      INSERT INTO web_sessions (
        tenant_id,
        token_hash,
        member_id,
        expires_at
      ) VALUES (
        ${record.tenantId}::uuid,
        ${record.tokenHash},
        ${record.memberId}::uuid,
        ${record.expiresAt}
      )
    `;
  }

  async getSession(
    tenantId: string,
    tokenHash: string,
    now: Date,
  ): Promise<SessionRecord | null> {
    const rows: SessionRow[] = await this.sql<SessionRow[]>`
      UPDATE web_sessions
      SET last_seen_at = ${now}
      WHERE tenant_id = ${tenantId}::uuid
        AND token_hash = ${tokenHash}
        AND revoked_at IS NULL
        AND expires_at > ${now}
      RETURNING token_hash, tenant_id, member_id, expires_at
    `;
    const row: SessionRow | undefined = rows[0];
    if (row === undefined) {
      return null;
    }
    return {
      tokenHash: row.token_hash,
      tenantId: row.tenant_id,
      memberId: row.member_id,
      expiresAt: toDate(row.expires_at),
    };
  }

  async revokeSession(
    tenantId: string,
    tokenHash: string,
  ): Promise<void> {
    await this.sql`
      UPDATE web_sessions
      SET revoked_at = CURRENT_TIMESTAMP
      WHERE tenant_id = ${tenantId}::uuid
        AND token_hash = ${tokenHash}
        AND revoked_at IS NULL
    `;
  }
}

export { PostgresWebAuthStore };
