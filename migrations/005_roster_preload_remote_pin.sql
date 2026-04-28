-- Roster preload + Filza-style remote PIN.
--
-- Two related changes:
--
-- 1. pin_hash is now nullable. A "roster preload" inserts a user with all
--    their metadata (name, role, rate, employment_type) and pin_hash NULL —
--    pre-approved by virtue of being on the manager-curated roster. When the
--    employee shows up at the kiosk and self-registers, the register flow
--    matches their first+last name to a roster row with NULL pin_hash and
--    fills it in. No PIN distribution required.
--
-- 2. pin_hash_remote is a second optional PIN per user. When matched, the
--    /kiosk/punch flow skips the geofence check — for hybrid/remote
--    employees (e.g. Filza Tirmizi) who can clock in from home or office.
--    The same user_id receives the punch either way, so payroll rolls up
--    cleanly. Brute-force lockout is shared between both PINs.

ALTER TABLE timeclock.users
  ALTER COLUMN pin_hash DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS pin_hash_remote VARCHAR(120);

-- Index to find roster-preload rows quickly during register name match.
CREATE INDEX IF NOT EXISTS idx_users_roster_preload
  ON timeclock.users(active, pin_hash)
  WHERE active = true AND pin_hash IS NULL;

INSERT INTO timeclock.schema_versions (version) VALUES ('005_roster_preload_remote_pin')
  ON CONFLICT DO NOTHING;
