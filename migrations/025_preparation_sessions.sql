BEGIN;

CREATE TABLE IF NOT EXISTS preparation_sessions (
  tenant_id uuid NOT NULL REFERENCES agent_tenants(id) ON DELETE CASCADE,
  actor_open_id varchar(255) NOT NULL,
  chat_id varchar(255) NOT NULL,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  state varchar(30) NOT NULL CHECK (state IN ('preparation_clarifying', 'closed')),
  source_message_id varchar(255) NOT NULL,
  raw_text text NOT NULL,
  draft jsonb CHECK (draft IS NULL),
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (tenant_id, actor_open_id, chat_id),
  UNIQUE (tenant_id, id)
);

COMMIT;
