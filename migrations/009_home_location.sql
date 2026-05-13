-- 009_home_location.sql
-- Adds home_location_id to users for per-office payroll attribution.
-- Rule (Anas 2026-05-01): payroll always rolls to a user's HOME office,
-- regardless of where the punch happened. Aubrey covers in Glendale →
-- still rolls into Gilbert payroll.
--
-- Also merges duplicate user records: id=19 (Maria Yeni Pelayo Rueles,
-- never finished onboarding) and id=24 (yeni pelayo, self-registered with
-- PIN, working at Glendale). Keep id=24's PIN + punch history; apply
-- id=19's authoritative name + role + pay rate. Deactivate id=19 per
-- no-destroying-credentials rule.
--
-- This migration is IDEMPOTENT — wrapped in IF NOT EXISTS for the column
-- and re-runnable for the seeds.

BEGIN;

-- 1. Schema change
ALTER TABLE timeclock.users
  ADD COLUMN IF NOT EXISTS home_location_id INTEGER REFERENCES timeclock.locations(id);

-- 2. Yeni merge (id=24 keeps PIN + punches; absorbs id=19's data)
UPDATE timeclock.users SET
  name = 'Maria Yeni Pelayo Rueles',
  role = 'front_desk',
  pay_rate_cents = 3100,
  aliases = ARRAY['yeni pelayo'],
  home_location_id = 3,
  updated_at = NOW()
WHERE id = 24;

-- 3. Deactivate id=19 (preserve all data per no-destroying-credentials rule)
UPDATE timeclock.users SET active = false, updated_at = NOW() WHERE id = 19;

-- 4. Seed home offices per Anas's dictation 2026-05-01

-- Gilbert (id=1): Annie, Aubrey, Ashley, Natalie, Grace, Jenna, Filza, Mesha, Sky
UPDATE timeclock.users SET home_location_id = 1
  WHERE id IN (1, 7, 11, 12, 13, 14, 16, 17, 21);

-- Mesa (id=2): Cynthia, Sofia, Aayushi, Ayda
UPDATE timeclock.users SET home_location_id = 2
  WHERE id IN (6, 8, 9, 10);

-- Glendale (id=3): Michelle, Marisa Gonzalez (id=24 set above in step 2)
UPDATE timeclock.users SET home_location_id = 3
  WHERE id IN (18, 25);

-- NULL home_location_id (no payroll attribution, intentional):
--   id=2  Anas Hasic (owner)
--   id=3  Dr. Revan Dawood (doctor, no track_hours)
--   id=4  Parsa Owtad (contractor)
--   id=5  Joshua James Baer (dentist, no track_hours)
--   id=15 Jaime Raulston (billing, remote)
--   id=23 Chad Hasic (tester, never delete)

COMMIT;
