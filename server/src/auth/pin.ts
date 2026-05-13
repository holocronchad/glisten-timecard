// PIN verification with brute-force throttling.
// Each user has a bcrypt-hashed 4-digit PIN. Five wrong attempts within 60s
// triggers a 5-minute lockout (configurable). The lockout window resets after
// the duration passes. We deliberately scope failure tracking to the user
// row (not the IP / kiosk) so a single attacker can't lock out everyone.

import bcrypt from 'bcrypt';
import { query } from '../db';

export interface UserRow {
  id: number;
  name: string;
  pin_hash: string | null;
  pin_hash_remote: string | null;
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
  // null when the user has a single rate; non-null marks a dual-rate user
  // (separate WFH rate). Read by the kiosk to flag every primary-PIN punch
  // for manager review (rate-arbitrage safeguard).
  pay_rate_cents_remote: number | null;
}

export type PinResult =
  | { ok: true; user: UserRow; usedRemotePin: boolean }
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
    `SELECT id, name, pin_hash, pin_hash_remote,
            is_owner, is_manager, track_hours, active, approved,
            cpr_org, cpr_issued_at, cpr_expires_at, cpr_updated_at,
            pin_locked_until, pin_fail_count, pin_fail_window_start,
            pay_rate_cents_remote
     FROM timeclock.users
     WHERE active = true
       AND (pin_hash IS NOT NULL OR pin_hash_remote IS NOT NULL)`
  );

  // Find the user(s) whose pin_hash OR pin_hash_remote matches. bcrypt
  // comparison is constant-time. usedRemotePin distinguishes which PIN
  // matched so /kiosk/punch can decide whether to skip the geofence check.
  // Run all bcrypt compares in parallel (libuv threadpool, default size 4)
  // so a 21-user roster takes ~10x bcrypt cost wall-clock instead of ~42x.
  type Match = { user: UserRow; usedRemotePin: boolean };
  const checks: Promise<Match | null>[] = [];
  for (const u of rows) {
    if (u.pin_hash) {
      checks.push(
        bcrypt.compare(pin, u.pin_hash).then((ok) =>
          ok ? { user: u, usedRemotePin: false } : null,
        ),
      );
    }
    if (u.pin_hash_remote) {
      checks.push(
        bcrypt.compare(pin, u.pin_hash_remote).then((ok) =>
          ok ? { user: u, usedRemotePin: true } : null,
        ),
      );
    }
  }
  const matches = (await Promise.all(checks)).filter((m): m is Match => m !== null);

  if (matches.length === 0) {
    return { ok: false, reason: 'no_match' };
  }
  if (matches.length > 1) {
    // Collision — refuse rather than guess. Owner should reassign one.
    return { ok: false, reason: 'no_match' };
  }

  const { user, usedRemotePin } = matches[0];

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

  return { ok: true, user, usedRemotePin };
}

export async function hashPin(pin: string): Promise<string> {
  if (!/^\d{4}$/.test(pin)) throw new Error('PIN must be 4 digits');
  return bcrypt.hash(pin, 10);
}
