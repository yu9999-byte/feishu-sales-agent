BEGIN;
ALTER TABLE proactive_sales_notifications
  ADD COLUMN IF NOT EXISTS message_payload jsonb;
COMMIT;
