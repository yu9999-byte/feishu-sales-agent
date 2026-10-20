BEGIN;
ALTER TABLE preparation_sessions
  ADD COLUMN IF NOT EXISTS preparation_context jsonb;
COMMIT;
