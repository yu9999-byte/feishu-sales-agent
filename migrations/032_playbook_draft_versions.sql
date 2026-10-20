BEGIN;

CREATE TABLE IF NOT EXISTS playbook_draft_versions (
  tenant_id uuid NOT NULL,
  candidate_id uuid NOT NULL,
  version integer NOT NULL CHECK (version > 0),
  expected_version integer NOT NULL CHECK (expected_version = version - 1),
  request_id uuid NOT NULL,
  author_member_id uuid NOT NULL,
  title varchar(120) NOT NULL CHECK (length(btrim(title)) BETWEEN 2 AND 120),
  body text NOT NULL CHECK (length(btrim(body)) BETWEEN 10 AND 20000),
  applicability varchar(1000) NOT NULL CHECK (length(btrim(applicability)) BETWEEN 2 AND 1000),
  change_note varchar(500) NOT NULL CHECK (length(btrim(change_note)) BETWEEN 2 AND 500),
  source_refs jsonb NOT NULL CHECK (jsonb_typeof(source_refs) = 'array'),
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (tenant_id, candidate_id, version),
  UNIQUE (tenant_id, candidate_id, request_id),
  FOREIGN KEY (tenant_id, candidate_id)
    REFERENCES playbook_optimization_candidates(tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, author_member_id)
    REFERENCES tenant_members(tenant_id, id) DEFERRABLE INITIALLY DEFERRED
);

COMMIT;
