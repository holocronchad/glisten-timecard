-- 011_remote_pay_rate.sql
-- Adds pay_rate_cents_remote to users so WFH-PIN hours are billed at a
-- different (typically lower) rate than office-PIN hours.
--
-- Background (Anas + Dr. Dawood 2026-05-03): Filza Tirmizi has both an
-- office PIN (geofence-required, $31/hr) and a WFH PIN (no geofence, $21/hr).
-- Before this migration the system stored only one rate per user, so payroll
-- couldn't split her WFH-rate hours from office-rate hours when computing
-- pay. Manager dashboard also couldn't display WFH vs office for currently
-- on-clock staff (paired with a backend/UI change that surfaces is_wfh).
--
-- Schema:
--   pay_rate_cents          → existing column. NOW EXPLICITLY THE OFFICE RATE.
--   pay_rate_cents_remote   → NEW. Used when location_id IS NULL on a punch
--                              (i.e., punch was made via WFH PIN). NULL means
--                              "no separate WFH rate; fall back to pay_rate_cents".
--
-- Idempotent — wrapped in IF NOT EXISTS.

BEGIN;

ALTER TABLE timeclock.users
  ADD COLUMN IF NOT EXISTS pay_rate_cents_remote INTEGER;

-- Seed Filza's WFH rate per Anas 2026-05-03.
UPDATE timeclock.users
   SET pay_rate_cents_remote = 2100,  -- $21.00/hr WFH
       updated_at = NOW()
 WHERE id = 16
   AND name = 'Filza Tirmizi';

COMMIT;
