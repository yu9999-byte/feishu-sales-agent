BEGIN;

ALTER TABLE followup_draft_versions
  ADD COLUMN IF NOT EXISTS progress_assessment jsonb;

COMMIT;
