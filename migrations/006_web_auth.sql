BEGIN;

CREATE TABLE IF NOT EXISTS web_login_states (
  tenant_id uuid NOT NULL
    REFERENCES agent_tenants(id) ON DELETE CASCADE,
  state_hash varchar(64) NOT NULL,
  redirect_path varchar(1000) NOT NULL,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (tenant_id, state_hash)
);

CREATE TABLE IF NOT EXISTS web_sessions (
  tenant_id uuid NOT NULL,
  token_hash varchar(64) NOT NULL,
  member_id uuid NOT NULL,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_seen_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (tenant_id, token_hash),
  FOREIGN KEY (tenant_id, member_id)
    REFERENCES tenant_members(tenant_id, id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_web_login_states_expiry
  ON web_login_states (expires_at, consumed_at);

CREATE INDEX IF NOT EXISTS idx_web_sessions_member
  ON web_sessions (tenant_id, member_id, expires_at, revoked_at);

COMMIT;
