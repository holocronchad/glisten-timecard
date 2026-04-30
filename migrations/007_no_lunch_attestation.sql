-- No-lunch attestation (Anas + Dr. Dawood ask 2026-04-29).
--
-- When an employee tries to clock_out from a shift ≥7 hours long without
-- any lunch_start/lunch_end pair in between, the kiosk asks why. The
-- typed reason is captured on the clock_out punch itself so Dr. Dawood
-- can review it in the manager dashboard. CHECK in app code: the column
-- is intentionally permissive at the DB level (any TEXT, including
-- existing rows = NULL) so we don't block historical data.

ALTER TABLE timeclock.punches
  ADD COLUMN IF NOT EXISTS no_lunch_reason TEXT;

-- Partial index for the manager "show me missed-lunch shifts" query.
CREATE INDEX IF NOT EXISTS idx_punches_no_lunch_reason
  ON timeclock.punches (ts DESC)
  WHERE no_lunch_reason IS NOT NULL;

INSERT INTO timeclock.schema_versions (version) VALUES ('007_no_lunch_attestation')
  ON CONFLICT DO NOTHING;
