BEGIN;

CREATE TABLE IF NOT EXISTS playbook_draft_review_events (
  tenant_id uuid NOT NULL,
  candidate_id uuid NOT NULL,
  sequence integer NOT NULL CHECK (sequence > 0),
  draft_version integer NOT NULL CHECK (draft_version > 0),
  expected_version integer NOT NULL CHECK (expected_version = draft_version),
  expected_review_sequence integer NOT NULL CHECK (expected_review_sequence = sequence - 1),
  request_id uuid NOT NULL,
  actor_member_id uuid NOT NULL,
  action varchar(30) NOT NULL CHECK (action IN ('submit', 'approve', 'request_changes')),
  note varchar(500) NOT NULL CHECK (length(btrim(note)) BETWEEN 2 AND 500),
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (tenant_id, candidate_id, sequence),
  UNIQUE (tenant_id, candidate_id, request_id),
  FOREIGN KEY (tenant_id, candidate_id)
    REFERENCES playbook_optimization_candidates(tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, candidate_id, draft_version)
    REFERENCES playbook_draft_versions(tenant_id, candidate_id, version)
    ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY (tenant_id, actor_member_id)
    REFERENCES tenant_members(tenant_id, id) DEFERRABLE INITIALLY DEFERRED
);

CREATE INDEX IF NOT EXISTS idx_playbook_draft_reviews_history
  ON playbook_draft_review_events (tenant_id, candidate_id, sequence DESC);

COMMIT;
