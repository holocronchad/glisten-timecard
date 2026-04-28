// PIN verification with brute-force throttling.
// Each user has a bcrypt-hashed 4-digit PIN. Five wrong attempts within 60s
// triggers a 5-minute lockout (configurable). The lockout window resets after
// the duration passes. We deliberately scope failure tracking to the user
// row (not the IP / kiosk) so a single attacker can't lock out everyone.

import bcrypt from 'bcrypt';
import { config } from '../config';
import { query } from '../db';

export interface UserRow {
  id: number;
  name: string;
  pin_hash: string;
  is_owner: boolean;
  is_manager: boolean;
  track_hours: boolean;
  active: boolean;
  approved: boolean;
  cpr_org: string | null;
  cpr_issued_at: Date | null;
  cpr_expires_at: Date | null;
  cpr_updated_at: Date | null;
  pin_locked_until: Date | null;
  pin_fail_count: number;
  pin_fail_window_start: Date | null;
}

export type PinResult =
  | { ok: true; user: UserRow }
  | { ok: false; reason: 'invalid_pin' | 'locked' | 'no_match' | 'inactive'; lockedUntil?: Date };

/**
 * Validate a PIN against ALL active users. We don't ask for "username" — the
 * PIN itself identifies the user. Collisions are possible (10000 combos for
 * 4 digits) but Glisten is ~20 employees so collision probability is low and
 * the kiosk PIN should be combined with a name confirmation step UI-side.
 *
 * If multiple users share a PIN, we treat as no_match for security (don't
 * leak the existence of a colliding PIN). UI tells the colliding user to
 * pick a different PIN — handled in the manager flow when assigning PINs.
 */
export async function findUserByPin(pin: string): Promise<PinResult> {
  if (!/^\d{4}$/.test(pin)) {
    return { ok: false, reason: 'invalid_pin' };
  }

  const { rows } = await query<UserRow>(
    `SELECT id, name, pin_hash, is_owner, is_manager, track_hours, active, approved,
            cpr_org, cpr_issued_at, cpr_expires_at, cpr_updated_at,
            pin_locked_until, pin_fail_count, pin_fail_window_start
     FROM timeclock.users
     WHERE active = true`
  );

  // Find the user(s) whose pin_hash matches. bcrypt comparison is constant-time.
  const matches: UserRow[] = [];
  for (const u of rows) {
    if (await bcrypt.compare(pin, u.pin_hash)) {
      matches.push(u);
    }
  }

  if (matches.length === 0) {
    return { ok: false, reason: 'no_match' };
  }
  if (matches.length > 1) {
    // Collision — refuse rather than guess. Owner should reassign one.
    return { ok: false, reason: 'no_match' };
  }

  const user = matches[0];

  // Honor active lockout
  if (user.pin_locked_until && user.pin_locked_until > new Date()) {
    return { ok: false, reason: 'locked', lockedUntil: user.pin_locked_until };
  }

  // Reset fail counter on successful match
  if (user.pin_fail_count > 0) {
    await query(
      `UPDATE timeclock.users
       SET pin_fail_count = 0, pin_fail_window_start = NULL, pin_locked_until = NULL
       WHERE id = $1`,
      [user.id]
    );
  }

  return { ok: true, user };
}

/**
 * Record a failed PIN attempt. We can't tie it to a user (we don't know who),
 * so we throttle in a separate table OR simply rely on a global rate-limiter
 * at the route level. For MVP we trust the route-level limiter.
 *
 * If you want per-user lockout, call this with a known user_id when a wrong
 * PIN is supplied for THAT user (e.g., during a "change PIN" flow). For the
 * generic kiosk lookup above, no user is known on failure.
 */
export async function recordPinFailureForUser(userId: number): Promise<void> {
  const window = await query<{ pin_fail_window_start: Date | null; pin_fail_count: number }>(
    `SELECT pin_fail_window_start, pin_fail_count FROM timeclock.users WHERE id = $1`,
    [userId]
  );
  const row = window.rows[0];
  if (!row) return;
  const now = new Date();
  const windowAge = row.pin_fail_window_start
    ? (now.getTime() - row.pin_fail_window_start.getTime()) / 1000
    : Infinity;
  let nextCount = row.pin_fail_count + 1;
  let nextWindowStart: Date = row.pin_fail_window_start ?? now;
  if (windowAge > 60) {
    nextCount = 1;
    nextWindowStart = now;
  }
  let lockedUntil: Date | null = null;
  if (nextCount >= config.pinLockoutAfterFails) {
    lockedUntil = new Date(now.getTime() + config.pinLockoutDurationMinutes * 60_000);
  }
  await query(
    `UPDATE timeclock.users
     SET pin_fail_count = $1,
         pin_fail_window_start = $2,
         pin_locked_until = COALESCE($3, pin_locked_until)
     WHERE id = $4`,
    [nextCount, nextWindowStart, lockedUntil, userId]
  );
}

export async function hashPin(pin: string): Promise<string> {
  if (!/^\d{4}$/.test(pin)) throw new Error('PIN must be 4 digits');
  return bcrypt.hash(pin, 10);
}
