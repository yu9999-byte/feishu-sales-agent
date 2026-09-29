BEGIN;

ALTER TABLE stale_opportunity_reminders
  DROP CONSTRAINT IF EXISTS stale_opportunity_reminders_status_check;

ALTER TABLE stale_opportunity_reminders
  ADD COLUMN IF NOT EXISTS dispatch_started_at timestamptz,
  ADD CONSTRAINT stale_opportunity_reminders_status_check
    CHECK (
      status IN (
        'claimed',
        'dispatching',
        'sent',
        'failed',
        'uncertain'
      )
    );

COMMIT;
