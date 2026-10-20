BEGIN;

CREATE TABLE IF NOT EXISTS preparation_results (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES agent_tenants(id) ON DELETE CASCADE,
  actor_open_id varchar(255) NOT NULL,
  source_message_id varchar(255) NOT NULL,
  request jsonb NOT NULL,
  report jsonb NOT NULL,
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (tenant_id, actor_open_id, source_message_id)
);

COMMIT;
