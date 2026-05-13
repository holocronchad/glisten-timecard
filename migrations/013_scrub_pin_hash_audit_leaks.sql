-- 013_scrub_pin_hash_audit_leaks.sql
-- Strips pin_hash, pin_hash_remote, and password_hash sub-keys from
-- before_state / after_state JSONB blobs in timeclock.audit_log. Four
-- known-leaking rows (id 20, 22, 161, 162) captured Filza's WFH-PIN bcrypt
-- when redactUser only stripped pin_hash, not pin_hash_remote (gap closed
-- 2026-05-04 in routes/manage.ts).
--
-- Rationale: bcrypt hashes of 4-digit PINs are brute-forceable in seconds,
-- so they must not sit in the audit log even though /manage/audit is
-- owner-gated and now also strips them on serialization. Defense-in-depth.
--
-- This migration is purely SUBTRACTIVE on JSONB blobs — it does NOT touch
-- any actual credential in timeclock.users. The live PIN hashes in
-- users.pin_hash_remote remain unchanged.
--
-- Idempotent: jsonb `- 'key'` is a no-op when the key is absent.
--
-- ⚠ Application code change required FIRST: redactUser in
-- server/src/routes/manage.ts must strip pin_hash_remote (deployed
-- 2026-05-04). Otherwise the next staff edit will re-leak.

BEGIN;

UPDATE timeclock.audit_log
   SET before_state = before_state - 'pin_hash' - 'pin_hash_remote' - 'password_hash',
       after_state  = after_state  - 'pin_hash' - 'pin_hash_remote' - 'password_hash'
 WHERE before_state ? 'pin_hash' OR before_state ? 'pin_hash_remote' OR before_state ? 'password_hash'
    OR after_state  ? 'pin_hash' OR after_state  ? 'pin_hash_remote' OR after_state  ? 'password_hash';

INSERT INTO timeclock.schema_versions (version) VALUES ('013_scrub_pin_hash_audit_leaks')
  ON CONFLICT DO NOTHING;

COMMIT;
