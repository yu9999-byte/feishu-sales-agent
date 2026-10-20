BEGIN;
ALTER TABLE preparation_sessions
  ADD COLUMN IF NOT EXISTS revision integer NOT NULL DEFAULT 1 CHECK (revision > 0);
COMMIT;
