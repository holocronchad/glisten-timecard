-- Primary-PIN monitor exemption (Dr. Dawood, 2026-06-01).
--
-- Background: the primary-PIN monitor (kiosk.ts, added 2026-04-29 for Filza,
-- generalized 2026-05-04) flags EVERY in-office primary-PIN punch from a
-- dual-rate user (one with a separate WFH rate, pay_rate_cents_remote IS NOT
-- NULL). The intent was a rate-arbitrage safeguard: catch the case where
-- someone RDPs into an office PC from home so the browser geolocates inside
-- the fence, then claims the in-office rate from their couch. A clean GPS
-- geofence pass does not rule that scenario out, so the monitor flagged
-- everything.
--
-- Problem in practice: Filza is the only dual-rate user, so the monitor
-- fired on 100% of her punches (47 flags / 30 days, all inside the geofence).
-- Dr. Dawood — who co-authored the monitor — reviewed every one against the
-- schedule, trusts her, and the constant flags read as alarming rather than
-- informative. That is alert fatigue, not anomaly detection.
--
-- Fix: a per-user opt-out. A staffer Dr. Dawood explicitly trusts is marked
-- primary_pin_monitor_exempt = true and their clean in-office punches stop
-- flooding the review queue. The control stays in place for any FUTURE
-- dual-rate hire (default false → monitored), so we keep the safeguard
-- without hardcoding anyone's name into application logic (no special cases).
--
-- Tradeoff (owner-accepted): exempting a user means we lose the
-- RDP-arbitrage signal for that user specifically. Dr. Dawood corroborates
-- against the schedule and accepts this for current trusted staff.

BEGIN;

ALTER TABLE timeclock.users
  ADD COLUMN IF NOT EXISTS primary_pin_monitor_exempt BOOLEAN NOT NULL DEFAULT false;

-- Grandfather every existing dual-rate staffer (today: just Filza) as
-- trusted. Keyed off the rate, not an id, so it is env-agnostic and survives
-- a reseed. New dual-rate hires land non-exempt and are monitored by default.
UPDATE timeclock.users
   SET primary_pin_monitor_exempt = true
 WHERE pay_rate_cents_remote IS NOT NULL;

INSERT INTO timeclock.schema_versions (version) VALUES ('017_primary_pin_monitor_exempt')
  ON CONFLICT DO NOTHING;

COMMIT;
