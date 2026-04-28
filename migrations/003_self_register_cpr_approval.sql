-- Self-register flow + CPR cert tracking + new-employee approval gate.
--
-- Existing users (Annie, the two owners) keep approved = TRUE — they were
-- manually seeded and don't need a second approval. New self-registrations
-- from the kiosk insert with approved = FALSE; their punches are collected
-- but excluded from payroll until a manager approves.

ALTER TABLE timeclock.users
  ADD COLUMN IF NOT EXISTS approved        BOOLEAN     NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS approved_by     INTEGER     REFERENCES timeclock.users(id),
  ADD COLUMN IF NOT EXISTS approved_at     TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS self_registered BOOLEAN     NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS cpr_org         VARCHAR(120),
  ADD COLUMN IF NOT EXISTS cpr_issued_at   DATE,
  ADD COLUMN IF NOT EXISTS cpr_expires_at  DATE,
  ADD COLUMN IF NOT EXISTS cpr_updated_at  TIMESTAMPTZ;

-- Hot index for the manager Pending tab + Today-view chip lookup.
CREATE INDEX IF NOT EXISTS idx_users_pending_approval
  ON timeclock.users(active, approved)
  WHERE active = true AND approved = false;

-- Index to surface CPR certs about to expire.
CREATE INDEX IF NOT EXISTS idx_users_cpr_expires
  ON timeclock.users(cpr_expires_at)
  WHERE cpr_expires_at IS NOT NULL AND active = true;

INSERT INTO timeclock.schema_versions (version) VALUES ('003_self_register_cpr_approval')
  ON CONFLICT DO NOTHING;
