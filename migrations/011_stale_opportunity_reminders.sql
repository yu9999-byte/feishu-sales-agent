BEGIN;

CREATE TABLE IF NOT EXISTS stale_opportunity_reminders (
  tenant_id uuid NOT NULL REFERENCES agent_tenants(id) ON DELETE CASCADE,
  opportunity_record_id varchar(255) NOT NULL,
  followup_version varchar(255) NOT NULL,
  reminder_kind varchar(50) NOT NULL,
  opportunity_name varchar(500) NOT NULL,
  owner_open_id varchar(255) NOT NULL,
  status varchar(20) NOT NULL
    CHECK (status IN ('claimed', 'sent', 'failed')),
  claim_token uuid NOT NULL,
  claim_expires_at timestamptz NOT NULL,
  attempt_count integer NOT NULL DEFAULT 1 CHECK (attempt_count > 0),
  last_attempt_at timestamptz NOT NULL,
  message_id varchar(255),
  sent_at timestamptz,
  retry_after timestamptz,
  failure_code varchar(100),
  failure_message text,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (
    tenant_id,
    opportunity_record_id,
    followup_version,
    reminder_kind
  ),
  CHECK (status <> 'sent' OR sent_at IS NOT NULL),
  CHECK (status <> 'failed' OR retry_after IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_stale_opportunity_reminders_retry
  ON stale_opportunity_reminders (status, retry_after, claim_expires_at);

COMMIT;
