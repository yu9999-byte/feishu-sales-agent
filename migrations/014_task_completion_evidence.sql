BEGIN;

ALTER TABLE task_status_snapshots
  ADD COLUMN IF NOT EXISTS completed_at timestamptz;

COMMIT;
