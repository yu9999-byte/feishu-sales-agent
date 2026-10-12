BEGIN;

CREATE TABLE IF NOT EXISTS feishu_user_credentials (
  tenant_id uuid NOT NULL
    REFERENCES agent_tenants(id) ON DELETE CASCADE,
  member_id uuid NOT NULL,
  access_token_ciphertext text NOT NULL,
  refresh_token_ciphertext text NOT NULL,
  access_token_expires_at timestamptz NOT NULL,
  refresh_token_expires_at timestamptz,
  scope text,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (tenant_id, member_id),
  FOREIGN KEY (tenant_id, member_id)
    REFERENCES tenant_members(tenant_id, id) ON DELETE CASCADE,
  CHECK (length(access_token_ciphertext) >= 32),
  CHECK (length(refresh_token_ciphertext) >= 32)
);

CREATE INDEX IF NOT EXISTS idx_feishu_user_credentials_expiry
  ON feishu_user_credentials (
    tenant_id,
    access_token_expires_at,
    refresh_token_expires_at
  );

COMMIT;
