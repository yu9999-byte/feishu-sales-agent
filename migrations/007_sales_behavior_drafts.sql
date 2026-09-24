BEGIN;

CREATE TABLE IF NOT EXISTS followup_input_jobs (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  actor_member_id uuid NOT NULL,
  source_type varchar(30) NOT NULL
    CHECK (source_type IN ('card_form', 'text', 'voice', 'minutes', 'document')),
  source_ref_hash varchar(64),
  source_text text NOT NULL,
  status varchar(30) NOT NULL DEFAULT 'pending_confirmation'
    CHECK (status IN (
      'received', 'processing', 'needs_input', 'pending_confirmation',
      'completed', 'failed', 'cancelled'
    )),
  attempt integer NOT NULL DEFAULT 1 CHECK (attempt > 0),
  idempotency_key varchar(255) NOT NULL,
  error_code varchar(100),
  retryable boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at timestamptz,
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id, actor_member_id, idempotency_key),
  FOREIGN KEY (tenant_id, actor_member_id)
    REFERENCES tenant_members(tenant_id, id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS followup_drafts (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  input_job_id uuid NOT NULL,
  owner_member_id uuid NOT NULL,
  source_type varchar(30) NOT NULL
    CHECK (source_type IN ('card_form', 'text', 'voice', 'minutes', 'document')),
  status varchar(30) NOT NULL DEFAULT 'pendingConfirmation'
    CHECK (status IN ('pendingConfirmation', 'confirmed', 'cancelled')),
  current_version integer NOT NULL DEFAULT 1 CHECK (current_version > 0),
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id, input_job_id),
  FOREIGN KEY (tenant_id, input_job_id)
    REFERENCES followup_input_jobs(tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, owner_member_id)
    REFERENCES tenant_members(tenant_id, id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS followup_draft_versions (
  tenant_id uuid NOT NULL,
  draft_id uuid NOT NULL,
  version integer NOT NULL CHECK (version > 0),
  creation_kind varchar(30) NOT NULL
    CHECK (creation_kind IN ('generated', 'user_edit', 'regenerated', 'confirmed')),
  source_text text NOT NULL,
  generated_body text NOT NULL,
  structured_fields jsonb NOT NULL,
  evidence jsonb NOT NULL DEFAULT '[]'::jsonb,
  quality_snapshot jsonb NOT NULL,
  llm_model varchar(150),
  prompt_version varchar(100) NOT NULL DEFAULT 'followup-p0-v1',
  schema_version varchar(100) NOT NULL DEFAULT 'followup-generation-v1',
  confirmed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (tenant_id, draft_id, version),
  FOREIGN KEY (tenant_id, draft_id)
    REFERENCES followup_drafts(tenant_id, id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_followup_drafts_owner_status
  ON followup_drafts (tenant_id, owner_member_id, status, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_followup_input_jobs_status
  ON followup_input_jobs (tenant_id, status, updated_at DESC);

COMMIT;
