BEGIN;

CREATE TABLE IF NOT EXISTS stale_opportunity_reminder_reconciliations (
  tenant_id uuid NOT NULL
    REFERENCES agent_tenants(id) ON DELETE CASCADE,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  opportunity_record_id varchar(255) NOT NULL,
  followup_version varchar(255) NOT NULL,
  reminder_kind varchar(50) NOT NULL,
  expected_updated_at timestamptz NOT NULL,
  previous_status varchar(20) NOT NULL
    CHECK (previous_status = 'uncertain'),
  decision varchar(30) NOT NULL
    CHECK (
      decision IN ('confirm_sent', 'authorize_retry', 'keep_frozen')
    ),
  resulting_status varchar(20) NOT NULL
    CHECK (resulting_status IN ('sent', 'failed', 'uncertain')),
  operator_member_id uuid NOT NULL,
  note text NOT NULL,
  evidence_message_id varchar(255),
  evidence_sent_at timestamptz,
  original_dispatch_started_at timestamptz,
  original_failure_code varchar(100),
  original_failure_message text,
  reconciled_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, operator_member_id)
    REFERENCES tenant_members(tenant_id, id),
  FOREIGN KEY (
    tenant_id,
    opportunity_record_id,
    followup_version,
    reminder_kind
  ) REFERENCES stale_opportunity_reminders (
    tenant_id,
    opportunity_record_id,
    followup_version,
    reminder_kind
  ),
  CHECK (length(btrim(note)) BETWEEN 5 AND 2000),
  CHECK (
    decision <> 'confirm_sent'
    OR (evidence_message_id IS NOT NULL AND evidence_sent_at IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_stale_reminder_reconciliations_record
  ON stale_opportunity_reminder_reconciliations (
    tenant_id,
    opportunity_record_id,
    followup_version,
    reminder_kind,
    reconciled_at DESC
  );

COMMIT;
