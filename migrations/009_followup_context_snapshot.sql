BEGIN;

ALTER TABLE followup_draft_versions
  ADD COLUMN IF NOT EXISTS context_snapshot jsonb;

COMMIT;
