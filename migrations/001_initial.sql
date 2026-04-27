-- Glisten Timecard — initial schema
-- Lives in `timeclock` schema inside the existing Holocron Postgres database.
-- Zero foreign-key relationships to Holocron tables. Rollback = DROP SCHEMA timeclock CASCADE.

CREATE SCHEMA IF NOT EXISTS timeclock;

-- ── Locations ────────────────────────────────────────────────────────────
-- Three Glisten offices to start. Geofence is a circle: lat/lng + radius.
CREATE TABLE IF NOT EXISTS timeclock.locations (
  id              SERIAL PRIMARY KEY,
  slug            VARCHAR(40) UNIQUE NOT NULL,
  name            VARCHAR(120) NOT NULL,
  address         TEXT,
  lat             DOUBLE PRECISION NOT NULL,
  lng             DOUBLE PRECISION NOT NULL,
  geofence_m      INTEGER NOT NULL DEFAULT 100,
  active          BOOLEAN NOT NULL DEFAULT true,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Users ────────────────────────────────────────────────────────────────
-- Employees + managers + owners share one table. Distinguished by flags.
-- pin_hash:        bcrypt of 4-digit PIN — every employee has one
-- password_hash:   bcrypt of password — only managers/owners
-- track_hours:     true for hourly+1099, false for owners (Anas, Dr. Dawood)
CREATE TABLE IF NOT EXISTS timeclock.users (
  id                SERIAL PRIMARY KEY,
  name              VARCHAR(120) NOT NULL,
  email             VARCHAR(180),
  pin_hash          VARCHAR(120) NOT NULL,
  password_hash     VARCHAR(120),
  role              VARCHAR(40) NOT NULL,
  employment_type   VARCHAR(8)  NOT NULL CHECK (employment_type IN ('W2','1099')),
  pay_rate_cents    INTEGER,
  is_owner          BOOLEAN NOT NULL DEFAULT false,
  is_manager        BOOLEAN NOT NULL DEFAULT false,
  track_hours       BOOLEAN NOT NULL DEFAULT true,
  active            BOOLEAN NOT NULL DEFAULT true,
  pin_locked_until  TIMESTAMPTZ,
  pin_fail_count    INTEGER NOT NULL DEFAULT 0,
  pin_fail_window_start TIMESTAMPTZ,
  last_login_at     TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email_active
  ON timeclock.users(email)
  WHERE email IS NOT NULL AND active = true;

-- ── Punches ──────────────────────────────────────────────────────────────
-- Append-only record of every clock in / out / lunch start / lunch end.
-- type:           the action taken
-- source:         where the punch came from
-- geofence_pass:  true if user was inside an office radius at punch time
-- flagged:        true when something needs manager review
-- auto_closed_at: set when an open punch is auto-closed by the daily cron
CREATE TABLE IF NOT EXISTS timeclock.punches (
  id              SERIAL PRIMARY KEY,
  user_id         INTEGER NOT NULL REFERENCES timeclock.users(id) ON DELETE RESTRICT,
  location_id     INTEGER REFERENCES timeclock.locations(id) ON DELETE RESTRICT,
  type            VARCHAR(16) NOT NULL CHECK (type IN ('clock_in','clock_out','lunch_start','lunch_end')),
  ts              TIMESTAMPTZ NOT NULL,
  source          VARCHAR(16) NOT NULL CHECK (source IN ('kiosk','personal','manager_edit','auto_close')),
  ip              INET,
  lat             DOUBLE PRECISION,
  lng             DOUBLE PRECISION,
  geofence_pass   BOOLEAN,
  flagged         BOOLEAN NOT NULL DEFAULT false,
  flag_reason     VARCHAR(64),
  auto_closed_at  TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_punches_user_ts ON timeclock.punches(user_id, ts DESC);
CREATE INDEX IF NOT EXISTS idx_punches_flagged ON timeclock.punches(flagged) WHERE flagged = true;
CREATE INDEX IF NOT EXISTS idx_punches_location_ts ON timeclock.punches(location_id, ts DESC);

-- ── Audit log ────────────────────────────────────────────────────────────
-- Every edit by a manager / owner. Immutable. before/after are JSONB snapshots.
CREATE TABLE IF NOT EXISTS timeclock.audit_log (
  id                SERIAL PRIMARY KEY,
  actor_user_id     INTEGER REFERENCES timeclock.users(id),
  resource_type     VARCHAR(32) NOT NULL,
  resource_id       INTEGER NOT NULL,
  action            VARCHAR(32) NOT NULL,
  before_state      JSONB,
  after_state       JSONB,
  reason            TEXT,
  ip                INET,
  ts                TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_audit_resource ON timeclock.audit_log(resource_type, resource_id);
CREATE INDEX IF NOT EXISTS idx_audit_actor ON timeclock.audit_log(actor_user_id);

-- ── Missed-punch requests ────────────────────────────────────────────────
-- Employee says "I forgot to clock in at 8 AM." Manager approves or denies.
-- On approve: a new punch is inserted with source='manager_edit', flagged=false.
CREATE TABLE IF NOT EXISTS timeclock.missed_punch_requests (
  id              SERIAL PRIMARY KEY,
  user_id         INTEGER NOT NULL REFERENCES timeclock.users(id) ON DELETE CASCADE,
  date            DATE NOT NULL,
  type            VARCHAR(16) NOT NULL CHECK (type IN ('clock_in','clock_out','lunch_start','lunch_end')),
  proposed_ts     TIMESTAMPTZ NOT NULL,
  reason          TEXT NOT NULL,
  status          VARCHAR(16) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','denied')),
  decided_by      INTEGER REFERENCES timeclock.users(id),
  decided_at      TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_missed_status ON timeclock.missed_punch_requests(status);

-- Migration tracker — used by server/src/scripts/migrate.ts
CREATE TABLE IF NOT EXISTS timeclock.schema_versions (
  version     VARCHAR(40) PRIMARY KEY,
  applied_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
INSERT INTO timeclock.schema_versions (version) VALUES ('001_initial')
  ON CONFLICT DO NOTHING;
