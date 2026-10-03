BEGIN;

CREATE TABLE IF NOT EXISTS task_status_events (
  tenant_id uuid NOT NULL REFERENCES agent_tenants(id) ON DELETE CASCADE,
  actor_open_id varchar(255) NOT NULL,
  event_id varchar(255) NOT NULL,
  task_guid varchar(255) NOT NULL,
  event_kind varchar(20) NOT NULL,
  title text NOT NULL,
  status varchar(50) NOT NULL,
  completed_at timestamptz,
  due_at timestamptz,
  task_url text,
  occurred_at timestamptz NOT NULL,
  previous_title text,
  previous_status varchar(50),
  previous_completed_at timestamptz,
  previous_due_at timestamptz,
  related_task_guid varchar(255),
  relation varchar(20),
  PRIMARY KEY (tenant_id, actor_open_id, event_id)
);

CREATE INDEX IF NOT EXISTS idx_task_status_events_lookup
  ON task_status_events (
    tenant_id,
    actor_open_id,
    task_guid,
    occurred_at DESC
  );

COMMIT;
