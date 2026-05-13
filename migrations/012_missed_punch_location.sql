-- 012_missed_punch_location.sql
-- Adds location_id to missed_punch_requests so the rate bucket is preserved
-- when a manager approves a missed punch.
--
-- Background (2026-05-04): /manage/missed/:id/decide previously inserted
-- approved missed punches with location_id = NULL hard-coded. For a single-
-- rate employee that was harmless. For Filza (and any future dual-rate
-- hire), it silently bucketed every approved missed punch as WFH-rate ($21)
-- even when the employee had filed a request for an office shift ($31).
-- Production damage was zero (no approved missed punches existed for any
-- dual-rate user yet) but the next one would have hit.
--
-- New column is nullable: NULL legitimately means "filed via WFH PIN" or
-- "legacy row created before this migration." The kiosk endpoint sets it
-- based on usedRemotePin at request time; the decide endpoint trusts the
-- recorded value and only falls back to home_location_id when NULL on a
-- single-rate user (where rate is the same either way).
--
-- Idempotent — IF NOT EXISTS.

BEGIN;

ALTER TABLE timeclock.missed_punch_requests
  ADD COLUMN IF NOT EXISTS location_id INTEGER REFERENCES timeclock.locations(id);

INSERT INTO timeclock.schema_versions (version) VALUES ('012_missed_punch_location')
  ON CONFLICT DO NOTHING;

COMMIT;
