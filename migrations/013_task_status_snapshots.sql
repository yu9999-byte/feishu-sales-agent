BEGIN;

CREATE TABLE IF NOT EXISTS task_status_snapshots (
  tenant_id uuid NOT NULL REFERENCES agent_tenants(id) ON DELETE CASCADE,
  actor_open_id varchar(255) NOT NULL,
  task_guid varchar(255) NOT NULL,
  title text NOT NULL,
  status varchar(50) NOT NULL,
  due_at timestamptz,
  task_url text,
  observed_at timestamptz NOT NULL,
  PRIMARY KEY (tenant_id, actor_open_id, task_guid)
);

CREATE INDEX IF NOT EXISTS idx_task_status_snapshots_observed
  ON task_status_snapshots (tenant_id, actor_open_id, observed_at DESC);

COMMIT;
