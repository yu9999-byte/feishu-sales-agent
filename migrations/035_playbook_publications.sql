BEGIN;

CREATE UNIQUE INDEX IF NOT EXISTS idx_playbook_review_exact_version
  ON playbook_draft_review_events (tenant_id, candidate_id, sequence, draft_version);

CREATE TABLE IF NOT EXISTS playbook_publication_events (
  tenant_id uuid NOT NULL,
  candidate_id uuid NOT NULL,
  sequence integer NOT NULL CHECK (sequence > 0),
  draft_version integer NOT NULL CHECK (draft_version > 0),
  approved_review_sequence integer NOT NULL CHECK (approved_review_sequence > 0),
  expected_publication_sequence integer NOT NULL CHECK (expected_publication_sequence = sequence - 1),
  expected_review_sequence integer,
  request_id uuid NOT NULL,
  actor_member_id uuid NOT NULL,
  action varchar(20) NOT NULL CHECK (action IN ('publish', 'withdraw')),
  note varchar(500) NOT NULL CHECK (length(btrim(note)) BETWEEN 2 AND 500),
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (tenant_id, candidate_id, sequence),
  UNIQUE (tenant_id, candidate_id, request_id),
  CHECK ((action = 'publish' AND expected_review_sequence IS NOT NULL
      AND expected_review_sequence = approved_review_sequence)
    OR (action = 'withdraw' AND expected_review_sequence IS NULL)),
  FOREIGN KEY (tenant_id, candidate_id)
    REFERENCES playbook_optimization_candidates(tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, candidate_id, approved_review_sequence, draft_version)
    REFERENCES playbook_draft_review_events(tenant_id, candidate_id, sequence, draft_version)
    ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY (tenant_id, actor_member_id)
    REFERENCES tenant_members(tenant_id, id) DEFERRABLE INITIALLY DEFERRED
);

COMMIT;
