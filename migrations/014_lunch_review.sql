-- Lunch review queue (Anas + Dr. Dawood, 2026-05-05).
--
-- Extends the existing 7-hour no-lunch attestation (migration 007) to also
-- catch *short* lunches (recorded lunch < 15 min) and to let Dr. Dawood
-- approve / reject each flagged shift from the manager dashboard. Until now
-- 007 captured a free-form reason on the clock_out punch but had no
-- workflow attached — items just sat in the audit log.
--
-- Design notes:
--   - status NULL means "not flagged for review" — keeps the partial index
--     small and avoids touching the vast majority of clock_out rows.
--   - reason is the trigger kind, NOT the employee's typed reason. The
--     typed reason still lives on punches.no_lunch_reason (column kept for
--     back-compat). Two separate fields because we need the trigger kind
--     for queue grouping + filters.
--   - minutes records actual lunch length when reason='short_lunch' (and
--     stays NULL for reason='no_lunch'), so the dashboard can render
--     "Lunch was only 7 minutes" without recomputing from punches.

BEGIN;

ALTER TABLE timeclock.punches
  ADD COLUMN IF NOT EXISTS lunch_review_status TEXT
    CHECK (lunch_review_status IN ('pending', 'approved', 'rejected')),
  ADD COLUMN IF NOT EXISTS lunch_review_reason TEXT
    CHECK (lunch_review_reason IN ('no_lunch', 'short_lunch')),
  ADD COLUMN IF NOT EXISTS lunch_review_minutes INTEGER,
  ADD COLUMN IF NOT EXISTS lunch_reviewed_by INTEGER REFERENCES timeclock.users(id),
  ADD COLUMN IF NOT EXISTS lunch_reviewed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS lunch_review_notes TEXT;

-- Partial index for the dashboard "Lunch Review" queue (pending only —
-- approved/rejected items live longer-term but are queried by punch_id /
-- user_id / date filters via the existing punches indexes).
CREATE INDEX IF NOT EXISTS idx_punches_lunch_review_pending
  ON timeclock.punches (ts DESC)
  WHERE lunch_review_status = 'pending';

-- Backfill: any historical clock_out with a no_lunch_reason captured under
-- migration 007 was a no-lunch shift that never got a manager decision.
-- Land them in the queue as 'pending' so Dr. Dawood can clear them out
-- (Cynthia Casas 2026-05-04 punch 264 is the immediate one). Idempotent:
-- only touches rows where status IS NULL.
UPDATE timeclock.punches
SET lunch_review_status = 'pending',
    lunch_review_reason = 'no_lunch'
WHERE type = 'clock_out'
  AND no_lunch_reason IS NOT NULL
  AND lunch_review_status IS NULL;

INSERT INTO timeclock.schema_versions (version) VALUES ('014_lunch_review')
  ON CONFLICT DO NOTHING;

COMMIT;
