BEGIN;

CREATE UNIQUE INDEX IF NOT EXISTS idx_playbook_publication_exact_version
  ON playbook_publication_events (tenant_id, candidate_id, sequence, draft_version);

CREATE TABLE IF NOT EXISTS playbook_adoption_events (
  tenant_id uuid NOT NULL,
  candidate_id uuid NOT NULL,
  sequence integer NOT NULL CHECK (sequence > 0),
  publication_version integer NOT NULL CHECK (publication_version > 0),
  publication_sequence integer NOT NULL CHECK (publication_sequence > 0),
  expected_adoption_sequence integer NOT NULL CHECK (expected_adoption_sequence = sequence - 1),
  request_id uuid NOT NULL,
  actor_member_id uuid NOT NULL,
  action varchar(20) NOT NULL CHECK (action IN ('record', 'retract')),
  evidence_kind varchar(30),
  evidence_record_id varchar(255),
  evidence_action_id uuid,
  evidence_note varchar(500),
  note varchar(500) NOT NULL CHECK (length(btrim(note)) BETWEEN 2 AND 500),
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (tenant_id, candidate_id, sequence),
  UNIQUE (tenant_id, candidate_id, request_id),
  CHECK ((action = 'record' AND evidence_kind IN ('followup', 'opportunity', 'task')
      AND evidence_record_id IS NOT NULL AND evidence_action_id IS NOT NULL
      AND evidence_note IS NOT NULL AND length(btrim(evidence_note)) BETWEEN 2 AND 500)
    OR (action = 'retract' AND evidence_kind IS NULL AND evidence_record_id IS NULL
      AND evidence_action_id IS NULL AND evidence_note IS NULL)),
  FOREIGN KEY (tenant_id, candidate_id)
    REFERENCES playbook_optimization_candidates(tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, candidate_id, publication_sequence, publication_version)
    REFERENCES playbook_publication_events(tenant_id, candidate_id, sequence, draft_version)
    ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY (tenant_id, evidence_action_id)
    REFERENCES pending_actions(tenant_id, id) ON DELETE NO ACTION,
  FOREIGN KEY (tenant_id, actor_member_id)
    REFERENCES tenant_members(tenant_id, id) DEFERRABLE INITIALLY DEFERRED
);

CREATE INDEX IF NOT EXISTS idx_playbook_adoptions_publication
  ON playbook_adoption_events (tenant_id, candidate_id, publication_sequence, publication_version);
CREATE INDEX IF NOT EXISTS idx_playbook_adoptions_action
  ON playbook_adoption_events (tenant_id, evidence_action_id);

COMMIT;
