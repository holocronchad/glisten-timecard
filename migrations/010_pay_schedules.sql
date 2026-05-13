-- 010_pay_schedules.sql
-- Adds per-location pay schedules so the timecard can match Paychex Oasis.
--
-- Background (Anas 2026-05-03): the prior code used a single global biweekly
-- anchor (PAY_PERIOD_ANCHOR=2026-01-05). That was wrong in TWO ways:
--   1. Gilbert's actual biweekly cadence runs through 2026-04-20 (Mondays).
--      105 days from 2026-01-05 to 2026-04-20 = 7.5 periods → off by 7 days.
--   2. Mesa + Glendale aren't biweekly at all — they're SEMI-MONTHLY
--      (1st-15th, 16th-EOM), which fixed-length math literally cannot express.
--
-- After this migration:
--   Gilbert  (location_id=1): biweekly, anchor 2026-04-20, length 14
--   Mesa     (location_id=2): semi_monthly (1st-15th, 16th-EOM)
--   Glendale (location_id=3): semi_monthly (1st-15th, 16th-EOM)
--
-- Source of truth: the 6 Paychex Oasis "Pay Period Schedule Report" PDFs
-- pulled by Anas on 2026-04-29 (W2 + 1099 schedules per location, both share
-- the same period boundaries within a location).
--
-- Idempotent — wrapped in IF NOT EXISTS / ON CONFLICT.

BEGIN;

CREATE TABLE IF NOT EXISTS timeclock.pay_schedules (
  location_id   INTEGER PRIMARY KEY REFERENCES timeclock.locations(id),
  schedule_type TEXT NOT NULL CHECK (schedule_type IN ('biweekly', 'semi_monthly')),
  -- Used only when schedule_type='biweekly'. The first day of any historical
  -- pay period in this location's cadence (typically a Monday).
  anchor_date   DATE,
  -- Used only when schedule_type='biweekly'. Period length in days (always 14
  -- in current Glisten setup, but the column allows 7 for weekly etc.).
  length_days   INTEGER,
  -- Free-form notes. Useful for tracking which Paychex report PDF this came from.
  notes         TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (
    (schedule_type = 'biweekly'    AND anchor_date IS NOT NULL AND length_days IS NOT NULL)
    OR
    (schedule_type = 'semi_monthly' AND anchor_date IS NULL    AND length_days IS NULL)
  )
);

-- Seed (idempotent — UPSERT so re-running the migration is safe).
INSERT INTO timeclock.pay_schedules (location_id, schedule_type, anchor_date, length_days, notes) VALUES
  (1, 'biweekly',     '2026-04-20', 14, 'Glisten Dental Studio Gilbert (RD29163 + 1099 RD29369). Source: Paychex Oasis 2026-04-29.'),
  (2, 'semi_monthly', NULL,         NULL, 'Glisten Dental Mesa (RD29167 + 1099 RD29368). Periods 1st-15th and 16th-EOM. Source: Paychex Oasis 2026-04-29.'),
  (3, 'semi_monthly', NULL,         NULL, 'Glisten Glendale (RD29168 + 1099 RD29631). Periods 1st-15th and 16th-EOM. Source: Paychex Oasis 2026-04-29.')
ON CONFLICT (location_id) DO UPDATE SET
  schedule_type = EXCLUDED.schedule_type,
  anchor_date   = EXCLUDED.anchor_date,
  length_days   = EXCLUDED.length_days,
  notes         = EXCLUDED.notes,
  updated_at    = NOW();

COMMIT;
