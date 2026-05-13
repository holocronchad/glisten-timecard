# Glisten Timecard — Pre-rollout audit & pre-patches

**Date:** 2026-04-29 (afternoon, before full-staff rollout 2026-04-30)
**Audited by:** Claude (full read of all 3,487 lines of server source + 67 unit tests + live prod data sample)

This is what I checked, what I patched, and what's still latent.

---

## ✅ Patched & deployed today (2 deploys)

### 1. Geofence drift was rejecting closing/mid-shift punches
**Symptom Dr. Dawood reported:** "some employees can't hit the End Lunch button — it's bugged."

**Reality:** Jenna Henderson stuck on `lunch_start` since 12:11pm AZ. Annie/Ashley/Aubrey/Filza/Sofia clocked in at 8–9am with zero lunch punches all day. Mesha succeeded at the same kiosk. Pattern = **intermittent geofence rejection** caused by WiFi-based geolocation drift past the 150m radius.

**Fix:** `lunch_start`, `lunch_end`, and `clock_out` are now allowed outside geofence IF
- the previous punch was a matching "open" type at a known office, AND
- it was recorded within the last 12 hours

Punch is recorded with `flagged=true` and a `flag_reason` so manager can review. `clock_in` stays strict — that's the anti-fraud boundary.

**Manual cleanup:** Added a manager-edit `lunch_end` for Jenna at 12:55pm AZ (44-min lunch) so she's unstuck for today.

### 2. Stale-shift lockout
**Symptom:** Employee clocks in yesterday, forgets to clock out. Auto-close cron runs at 6:59 AM AZ next day. If they show up at 6:30 AM and try to clock in BEFORE the cron fires, the state machine rejects (`Not allowed: last was clock_in`).

**Fix:** When a `clock_in` is attempted and the latest punch is `clock_in`/`lunch_start` from > 16 hours ago, an inline auto-close runs first (records the close at start+8h, flagged for review), then the new clock_in proceeds. Safety net for the cron-arrival-time race.

### 3. Autonomous deploy unlocked
- `/srv/glisten-timecard/server/dist` and `web/dist` now owned by `holocron` SSH user (no sudo needed for file copy)
- Passwordless sudo scoped narrowly to `pm2 restart glisten-timecard` (and reload/status/logs for that one process)
- Documented in `~/.claude/projects/-Users-holocronai/memory/reference_glisten_timecard_deploy.md`

This was the second deploy of the day — first one needed Anas in DO Console to set up the unlock, second deploy ran end-to-end from local with zero login.

---

## 🟡 Latent issues — not blocking, document for future

### 4. PIN brute-force lockout never triggers
- `recordPinFailureForUser` requires a known user_id, but the kiosk `/lookup` endpoint that fails doesn't know which user (PIN-only auth). So `pin_locked_until` / `pin_fail_count` columns never get incremented.
- Risk: someone could brute-force PINs (10000 combos for 4 digits) without rate limiting kicking in. bcrypt slows it but doesn't stop it.
- Fix later: add `express-rate-limit` middleware on `/kiosk/lookup` (e.g., 30 attempts per IP per hour).

### 5. PIN collision UX
- If two employees set the same 4-digit PIN, `findUserByPin` returns `no_match` for security (doesn't leak the collision). Both colliding users would see "Unknown PIN" and be locked out.
- Today's collision guard runs at PIN-set time (registration, manager edit) and rejects duplicates. So this is theoretical for new PINs but possible for legacy data.
- Verified today: no duplicate PINs in current users table.

### 6. Race condition on simultaneous punches
- If a user fires two punch requests at literally the same millisecond, both fetch `latest` independently and both pass the state machine. Could end up with two `clock_out` rows, or duplicate punches.
- Real-world frequency: near-zero (employees tap once, network round-trip is 100+ ms).
- Fix later: wrap punch creation in a SERIALIZABLE transaction with FOR UPDATE on the latest punch.

### 7. Auto-close fallback timestamp can over-credit hours
- If employee clocks in at 9 AM and forgets to clock out, the cron records `clock_out` at 5 PM (start + 8h cap). They get credited 8 hours regardless of actual time worked.
- Mitigation in place: punch is `flagged=true` with `flag_reason='auto_close_open_shift'`. Manager reviews flagged punches in the period view (`flagged_count` shown per employee).
- Better fix later: make the fallback shift configurable per employee (e.g., part-timers default to 4h not 8h), or send a Slack/email when an auto-close fires.

### 8. JWT mid-action expiry
- Manager session tokens TTL = 8h. If a manager logs in at 8 AM and starts a long form at 3:55 PM, the JWT could expire mid-submission. Frontend shows "Missing token" error.
- Fix later: silent refresh in the `api()` wrapper when a 401 hits, OR longer TTL with rotation.

### 9. Hours crossing midnight attribute to start date
- `totalsByDay` uses `s.start` to assign segments to a day bucket. A shift starting at 11 PM and ending 2 AM puts the whole 3 hours under the start date.
- Glisten hours are 8 AM – 5 PM, so this isn't a real-world problem here. Note for any future emergency-call-out logic.

### 10. CPR endpoint allows unapproved users
- `/kiosk/cpr` accepts updates from any active user with a valid PIN, including pending self-registered ones. Probably fine — there's no harm in collecting CPR info early. Just noted.

---

## 📋 What I checked

- ✅ `auth/pin.ts` — bcrypt PIN check, lockout logic, primary + remote PIN routing
- ✅ `auth/middleware.ts` — JWT verification, requireOwner gating
- ✅ `routes/kiosk.ts` (691 lines) — lookup, register (3 paths: exact / suggest / self), CPR, punch, missed-punch
- ✅ `routes/manage.ts` (982 lines) — login, today, pending, approve/deny, period, payroll CSV, punch CRUD, employee detail, staff CRUD, locations, audit
- ✅ `services/punches.ts` — state machine + recordPunch
- ✅ `services/hours.ts` — segment building, daily totals
- ✅ `services/payroll.ts` — period calculations
- ✅ `services/nameMatch.ts` — Levenshtein + alias matcher for self-registration
- ✅ `services/geofence.ts` — Haversine matchLocation
- ✅ `jobs/autoClose.ts` — daily 6:59 AM AZ cron sweep
- ✅ `config.ts` — env var loading, fail-fast
- ✅ All 67 unit tests pass after both code changes

## Live prod data verified

- 17 active employees, 2 owners (Anas, Dr. Dawood — both is_owner + is_manager)
- 3 office locations with 150m geofence each
- 23 punches recorded today (post-Jenna patch)
- 8 employees on `clock_in` status as of audit time, 1 on `lunch_end` (Mesha — successfully ended), Jenna patched

## What's NOT covered (future audit areas)

- Frontend resilience: behavior on slow / spotty connection, offline punches, PWA install issues, iOS Safari edge cases
- Migration safety: applying new schema migrations to live DB (none pending today)
- Backup / restore: I don't see backup automation. Postgres point-in-time recovery via DO managed DB exists but never verified.
- Monitoring / alerting: no Sentry / no PagerDuty / no Slack notification on errors. If timecard crashes, nobody knows.
