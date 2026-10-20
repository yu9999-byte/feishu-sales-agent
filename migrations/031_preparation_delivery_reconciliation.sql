BEGIN;

ALTER TABLE preparation_result_deliveries
  ADD COLUMN IF NOT EXISTS reconciliation_version integer NOT NULL DEFAULT 1;

CREATE TABLE IF NOT EXISTS preparation_result_delivery_reconciliations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  result_id uuid NOT NULL REFERENCES preparation_results(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL REFERENCES agent_tenants(id) ON DELETE CASCADE,
  actor_open_id varchar(255) NOT NULL,
  operator_member_id uuid NOT NULL,
  decision varchar(30) NOT NULL CHECK (decision = 'confirm_sent'),
  expected_version integer NOT NULL,
  note text NOT NULL CHECK (length(btrim(note)) BETWEEN 5 AND 2000),
  evidence_message_id varchar(255) NOT NULL,
  evidence_sent_at timestamptz NOT NULL,
  reconciled_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (tenant_id, operator_member_id)
    REFERENCES tenant_members(tenant_id, id),
  FOREIGN KEY (tenant_id, actor_open_id)
    REFERENCES tenant_members(tenant_id, feishu_open_id)
);

CREATE INDEX IF NOT EXISTS idx_preparation_delivery_reconciliations_result
  ON preparation_result_delivery_reconciliations (tenant_id, result_id, reconciled_at DESC);

COMMIT;
