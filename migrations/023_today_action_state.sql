BEGIN;
CREATE TABLE IF NOT EXISTS today_action_states (
  tenant_id uuid NOT NULL REFERENCES agent_tenants(id) ON DELETE CASCADE,
  member_id uuid NOT NULL,
  item_id text NOT NULL,
  item_version text NOT NULL,
  revision integer NOT NULL DEFAULT 0 CHECK (revision >= 0),
  status text NOT NULL CHECK (status IN ('open', 'snoozed', 'resolved')),
  remind_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (tenant_id, member_id, item_id, item_version),
  FOREIGN KEY (tenant_id, member_id) REFERENCES tenant_members(tenant_id, id) ON DELETE CASCADE,
  CHECK ((status = 'snoozed') = (remind_at IS NOT NULL))
);
CREATE TABLE IF NOT EXISTS today_action_operations (
  tenant_id uuid NOT NULL,
  member_id uuid NOT NULL,
  idempotency_key text NOT NULL,
  request_fingerprint text NOT NULL,
  item_id text NOT NULL,
  item_version text NOT NULL,
  operation text NOT NULL CHECK (operation IN ('snooze', 'resolve', 'generate_followup', 'create_task')),
  result jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (tenant_id, member_id, idempotency_key),
  FOREIGN KEY (tenant_id, member_id) REFERENCES tenant_members(tenant_id, id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_today_action_reminders
  ON today_action_states (remind_at) WHERE status = 'snoozed';
COMMIT;
