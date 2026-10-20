BEGIN;

ALTER TABLE preparation_results
  ADD COLUMN IF NOT EXISTS draft_edits jsonb NOT NULL DEFAULT '[]'::jsonb
    CHECK (jsonb_typeof(draft_edits) = 'array'),
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP;

COMMIT;
