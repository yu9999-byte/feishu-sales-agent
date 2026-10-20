BEGIN;

CREATE TABLE IF NOT EXISTS preparation_result_deliveries (
  result_id uuid PRIMARY KEY REFERENCES preparation_results(id) ON DELETE CASCADE,
  chat_id varchar(255) NOT NULL,
  status varchar(20) NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'dispatching', 'sent', 'unknown')),
  frozen_text text,
  claim_token uuid,
  started_at timestamptz,
  message_id varchar(255),
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);

COMMIT;
