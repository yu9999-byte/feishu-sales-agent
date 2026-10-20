BEGIN;

CREATE TABLE IF NOT EXISTS task_promise_evidence_events (
  tenant_id uuid NOT NULL,
  action_id uuid NOT NULL,
  revision integer NOT NULL CHECK (revision > 0),
  expected_revision integer NOT NULL CHECK (expected_revision = revision - 1),
  request_id uuid NOT NULL,
  actor_member_id uuid NOT NULL,
  actor_open_id varchar(255) NOT NULL,
  state varchar(30) NOT NULL CHECK (state IN ('reported_fulfilled', 'reported_partial', 'retracted')),
  note varchar(500) NOT NULL CHECK (length(btrim(note)) BETWEEN 2 AND 500),
  evidence_url varchar(2048),
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (tenant_id, action_id, revision),
  UNIQUE (tenant_id, action_id, request_id),
  CHECK (state = 'retracted' OR evidence_url IS NOT NULL),
  FOREIGN KEY (tenant_id, action_id) REFERENCES pending_actions(tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, actor_member_id) REFERENCES tenant_members(tenant_id, id) DEFERRABLE INITIALLY DEFERRED
);

COMMIT;
