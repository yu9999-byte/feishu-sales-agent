BEGIN;

ALTER TABLE proactive_sales_notifications
  ADD COLUMN IF NOT EXISTS id uuid NOT NULL DEFAULT gen_random_uuid(),
  ADD COLUMN IF NOT EXISTS attempt_limit integer;

CREATE UNIQUE INDEX IF NOT EXISTS
  uq_proactive_sales_notifications_tenant_id
  ON proactive_sales_notifications (tenant_id, id);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'proactive_sales_notifications_attempt_limit_check'
  ) THEN
    ALTER TABLE proactive_sales_notifications
      ADD CONSTRAINT proactive_sales_notifications_attempt_limit_check
      CHECK (attempt_limit IS NULL OR attempt_limit >= attempt_count);
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS proactive_sales_notification_reconciliations (
  tenant_id uuid NOT NULL
    REFERENCES agent_tenants(id) ON DELETE CASCADE,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  notification_id uuid NOT NULL,
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
  original_attempt_count integer NOT NULL,
  original_dispatch_started_at timestamptz,
  original_failure_code varchar(100),
  original_failure_message text,
  reconciled_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, notification_id)
    REFERENCES proactive_sales_notifications(tenant_id, id),
  FOREIGN KEY (tenant_id, operator_member_id)
    REFERENCES tenant_members(tenant_id, id),
  CHECK (length(btrim(note)) BETWEEN 5 AND 2000),
  CHECK (
    decision <> 'confirm_sent'
    OR (evidence_message_id IS NOT NULL AND evidence_sent_at IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_proactive_notification_reconciliations_record
  ON proactive_sales_notification_reconciliations (
    tenant_id,
    notification_id,
    reconciled_at DESC
  );

COMMIT;
