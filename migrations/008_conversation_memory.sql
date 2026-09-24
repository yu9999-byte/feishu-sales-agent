BEGIN;

CREATE TABLE IF NOT EXISTS conversation_turns (
  tenant_id uuid NOT NULL REFERENCES agent_tenants(id) ON DELETE CASCADE,
  actor_open_id varchar(255) NOT NULL,
  chat_id varchar(255) NOT NULL,
  message_id varchar(255) NOT NULL,
  role varchar(20) NOT NULL CHECK (role IN ('user', 'assistant')),
  content text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at timestamptz NOT NULL,
  PRIMARY KEY (tenant_id, message_id, role)
);

CREATE INDEX IF NOT EXISTS idx_conversation_turns_context
  ON conversation_turns (
    tenant_id,
    actor_open_id,
    chat_id,
    created_at DESC
  );

COMMIT;
