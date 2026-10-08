BEGIN;

CREATE TABLE IF NOT EXISTS playbook_optimization_candidates (
  tenant_id uuid NOT NULL
    REFERENCES agent_tenants(id) ON DELETE CASCADE,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  question_fingerprint varchar(64) NOT NULL,
  topic_preview varchar(120) NOT NULL,
  last_qa_status varchar(30) NOT NULL
    CHECK (
      last_qa_status IN (
        'answered',
        'partial',
        'not_configured',
        'no_trusted_match',
        'unavailable'
      )
    ),
  occurrence_count integer NOT NULL DEFAULT 1
    CHECK (occurrence_count > 0),
  reasons jsonb NOT NULL DEFAULT '[]'::jsonb,
  source_refs jsonb NOT NULL DEFAULT '[]'::jsonb,
  status varchar(40) NOT NULL DEFAULT 'observing'
    CHECK (
      status IN (
        'observing',
        'pending_review',
        'accepted_for_authoring',
        'dismissed'
      )
    ),
  first_observed_at timestamptz NOT NULL,
  last_observed_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id, question_fingerprint),
  CHECK (jsonb_typeof(reasons) = 'array'),
  CHECK (jsonb_typeof(source_refs) = 'array')
);

CREATE TABLE IF NOT EXISTS playbook_optimization_reviews (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  candidate_id uuid NOT NULL,
  reviewer_member_id uuid NOT NULL,
  decision varchar(40) NOT NULL
    CHECK (decision IN ('accept_for_authoring', 'dismiss')),
  previous_status varchar(40) NOT NULL,
  resulting_status varchar(40) NOT NULL,
  expected_updated_at timestamptz NOT NULL,
  note varchar(500) NOT NULL,
  reviewed_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, candidate_id)
    REFERENCES playbook_optimization_candidates(tenant_id, id),
  FOREIGN KEY (tenant_id, reviewer_member_id)
    REFERENCES tenant_members(tenant_id, id),
  CHECK (length(btrim(note)) BETWEEN 2 AND 500)
);

CREATE INDEX IF NOT EXISTS idx_playbook_candidates_review_queue
  ON playbook_optimization_candidates (
    tenant_id,
    status,
    last_observed_at DESC
  );

CREATE INDEX IF NOT EXISTS idx_playbook_reviews_candidate
  ON playbook_optimization_reviews (
    tenant_id,
    candidate_id,
    reviewed_at DESC
  );

COMMIT;
