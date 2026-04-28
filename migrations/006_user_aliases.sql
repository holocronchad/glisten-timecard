-- Roster matcher hardening — aliases per user.
--
-- Lets the manager-curated roster carry nickname / common-misspelling
-- variants alongside the canonical name. The /kiosk/register flow checks
-- both the canonical name and every alias when matching the typed name,
-- with a Levenshtein "did you mean X?" fallback for typos and accents.

ALTER TABLE timeclock.users
  ADD COLUMN IF NOT EXISTS aliases TEXT[] NOT NULL DEFAULT '{}'::text[];

-- GIN index for fast contains-string-X lookups if we add direct alias
-- search later; currently the matcher reads all preload rows in one query.
CREATE INDEX IF NOT EXISTS idx_users_aliases ON timeclock.users USING GIN (aliases);

INSERT INTO timeclock.schema_versions (version) VALUES ('006_user_aliases')
  ON CONFLICT DO NOTHING;
