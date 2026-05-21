-- Lunch review deduction (Anas + Dr. Dawood, 2026-05-20).
--
-- Extends migration 014 (lunch review queue) with payroll teeth: when
-- Dr. Dawood REJECTS a flagged no-lunch / short-lunch shift, the system
-- deducts 30 minutes (1800 seconds) of paid time from that shift. Approve
-- keeps deduction at 0. Replaces the prior "for your records only" model.
--
-- Design notes:
--   - Column lives on `timeclock.punches` next to the rest of the
--     lunch_review_* fields. The deduction is carried on the CLOCK_OUT
--     punch row (the same row that gets flagged for review), so it's
--     local to the shift it deducts from.
--   - INTEGER NOT NULL DEFAULT 0. Every existing punch starts at 0 and
--     only flips to 1800 when Dr. Dawood explicitly rejects from the
--     dashboard. NO RETROACTIVE BACKFILL of historical 'rejected' rows
--     (per spec) — those were decided under the old "no deduction"
--     contract. Going forward only.
--   - Storing seconds (not minutes) for future flexibility — if the
--     deduction amount ever becomes configurable, partial-minute math
--     stays clean.
--   - Subtraction happens at the application layer (services/hours.ts
--     attaches the deduction to the matching paid Segment via
--     source_out_id; totalMinutes / totalsByDay / splitMinutes /
--     computeRateBreakdown all honor it). No SQL change to payroll
--     queries needed beyond including the column in punches SELECTs.

BEGIN;

ALTER TABLE timeclock.punches
  ADD COLUMN IF NOT EXISTS lunch_review_deduction_seconds INTEGER NOT NULL DEFAULT 0;

-- Defensive constraint: deduction can never be negative (would inflate hours)
-- and can never exceed 8 hours (28800s) which would be more than any single
-- shift could possibly contain — anything outside this range is a bug.
ALTER TABLE timeclock.punches
  ADD CONSTRAINT punches_lunch_review_deduction_range
    CHECK (lunch_review_deduction_seconds >= 0
       AND lunch_review_deduction_seconds <= 28800);

INSERT INTO timeclock.schema_versions (version) VALUES ('015_lunch_review_deduction')
  ON CONFLICT DO NOTHING;

COMMIT;
