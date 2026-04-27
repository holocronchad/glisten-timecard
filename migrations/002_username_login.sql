-- Manager login pivot: username + 4-digit PIN instead of email + password.
-- Adds a `username` column for owner/manager logins. Employees who only
-- punch the clock don't need a username — they're identified by the PIN
-- alone via findUserByPin.

ALTER TABLE timeclock.users
  ADD COLUMN IF NOT EXISTS username VARCHAR(60);

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username_active
  ON timeclock.users(LOWER(username))
  WHERE username IS NOT NULL AND active = true;

INSERT INTO timeclock.schema_versions (version) VALUES ('002_username_login')
  ON CONFLICT DO NOTHING;
