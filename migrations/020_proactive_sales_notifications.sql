BEGIN;

CREATE TABLE IF NOT EXISTS proactive_sales_notifications (
  tenant_id uuid NOT NULL REFERENCES agent_tenants(id) ON DELETE CASCADE,
  recipient_member_id uuid NOT NULL,
  recipient_open_id varchar(255) NOT NULL,
  kind varchar(50) NOT NULL,
  notification_key varchar(500) NOT NULL,
  subject_key varchar(500) NOT NULL,
  payload_fingerprint varchar(64) NOT NULL,
  status varchar(20) NOT NULL
    CHECK (status IN ('claimed', 'dispatching', 'sent', 'failed', 'uncertain')),
  claim_token uuid NOT NULL,
  claim_expires_at timestamptz NOT NULL,
  attempt_count integer NOT NULL DEFAULT 1 CHECK (attempt_count > 0),
  last_attempt_at timestamptz NOT NULL,
  dispatch_started_at timestamptz,
  message_id varchar(255),
  sent_at timestamptz,
  retry_after timestamptz,
  failure_code varchar(100),
  failure_message text,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (
    tenant_id,
    recipient_member_id,
    kind,
    notification_key
  ),
  FOREIGN KEY (tenant_id, recipient_member_id)
    REFERENCES tenant_members(tenant_id, id) ON DELETE CASCADE,
  CHECK (status <> 'sent' OR sent_at IS NOT NULL),
  CHECK (status <> 'failed' OR retry_after IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_proactive_sales_notifications_retry
  ON proactive_sales_notifications (
    status,
    retry_after,
    claim_expires_at
  );

CREATE TABLE IF NOT EXISTS proactive_sales_risk_states (
  tenant_id uuid NOT NULL REFERENCES agent_tenants(id) ON DELETE CASCADE,
  recipient_member_id uuid NOT NULL,
  opportunity_record_id varchar(255) NOT NULL,
  severity_rank integer NOT NULL CHECK (severity_rank BETWEEN 0 AND 3),
  payload_fingerprint varchar(64) NOT NULL,
  observed_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (
    tenant_id,
    recipient_member_id,
    opportunity_record_id
  ),
  FOREIGN KEY (tenant_id, recipient_member_id)
    REFERENCES tenant_members(tenant_id, id) ON DELETE CASCADE
);

COMMIT;
