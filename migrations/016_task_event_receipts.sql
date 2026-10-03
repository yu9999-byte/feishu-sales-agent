BEGIN;

CREATE TABLE IF NOT EXISTS task_event_receipts (
  tenant_id uuid NOT NULL REFERENCES agent_tenants(id) ON DELETE CASCADE,
  event_id varchar(255) NOT NULL,
  task_guid varchar(255) NOT NULL,
  event_types jsonb NOT NULL,
  occurred_at timestamptz NOT NULL,
  received_at timestamptz NOT NULL,
  receipt_status varchar(20) NOT NULL,
  payload_hash varchar(64) NOT NULL,
  PRIMARY KEY (tenant_id, event_id)
);

CREATE INDEX IF NOT EXISTS idx_task_event_receipts_task_occurred
  ON task_event_receipts (tenant_id, task_guid, occurred_at DESC);

COMMIT;
