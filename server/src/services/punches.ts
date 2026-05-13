// Punch business logic: read latest state, validate transitions, write.
// All writes go through here so audit-log + flag rules stay consistent.

import { query, withTransaction } from '../db';
import type { PoolClient } from 'pg';

export type PunchType = 'clock_in' | 'clock_out' | 'lunch_start' | 'lunch_end';
export type PunchSource = 'kiosk' | 'personal' | 'manager_edit' | 'auto_close';

export interface PunchRow {
  id: number;
  user_id: number;
  location_id: number | null;
  type: PunchType;
  ts: Date;
  source: PunchSource;
  geofence_pass: boolean | null;
  flagged: boolean;
  flag_reason: string | null;
  auto_closed_at: Date | null;
}

/**
 * Latest punch for a user — drives the kiosk UI's "what buttons to show" logic.
 * Pass `client` to read inside an existing transaction (pairs with the
 * per-user advisory lock in the kiosk punch handler).
 */
export async function getLatestPunch(
  userId: number,
  client?: PoolClient,
): Promise<PunchRow | null> {
  const sql = `SELECT id, user_id, location_id, type, ts, source, geofence_pass, flagged, flag_reason, auto_closed_at
     FROM timeclock.punches
     WHERE user_id = $1
     ORDER BY ts DESC
     LIMIT 1`;
  if (client) {
    const r = await client.query<PunchRow>(sql, [userId]);
    return r.rows[0] ?? null;
  }
  const { rows } = await query<PunchRow>(sql, [userId]);
  return rows[0] ?? null;
}

/**
 * Compute which punch types the user is allowed to record next.
 *
 * State machine (lunch RESTORED 2026-04-29 evening per Dr. Dawood reversal —
 * the silent-failure root cause was the kiosk's 30s name-phase auto-reset
 * timer, not the button itself):
 *   no punches yet                       -> [clock_in]
 *   last = clock_in                      -> [clock_out, lunch_start]
 *   last = lunch_start                   -> [lunch_end]
 *   last = lunch_end                     -> [clock_out, lunch_start]   (rare 2nd lunch)
 *   last = clock_out                     -> [clock_in]
 */
export function nextAllowedPunches(latest: PunchRow | null): PunchType[] {
  if (!latest) return ['clock_in'];
  switch (latest.type) {
    case 'clock_in':    return ['clock_out', 'lunch_start'];
    case 'lunch_start': return ['lunch_end'];
    case 'lunch_end':   return ['clock_out', 'lunch_start'];
    case 'clock_out':   return ['clock_in'];
    default:            return ['clock_in'];
  }
}

export type LunchReviewReason = 'no_lunch' | 'short_lunch';
export type LunchReviewStatus = 'pending' | 'approved' | 'rejected';

export interface RecordPunchInput {
  userId: number;
  locationId: number | null;
  type: PunchType;
  source: PunchSource;
  ip?: string | null;
  lat?: number | null;
  lng?: number | null;
  geofencePass?: boolean | null;
  ts?: Date;
  flagged?: boolean;
  flagReason?: string | null;
  autoClosedAt?: Date | null;
  noLunchReason?: string | null;
  // Lunch-review queue fields (migration 014). Set together when a
  // clock_out lands as a flagged no-lunch / short-lunch shift; remain
  // NULL for every other punch.
  lunchReviewStatus?: LunchReviewStatus | null;
  lunchReviewReason?: LunchReviewReason | null;
  lunchReviewMinutes?: number | null;
  client?: PoolClient;
}

export async function recordPunch(input: RecordPunchInput): Promise<PunchRow> {
  const ts = input.ts ?? new Date();
  const exec = async (q: any) => {
    const r = await q.query(
      `INSERT INTO timeclock.punches
         (user_id, location_id, type, ts, source, ip, lat, lng, geofence_pass,
          flagged, flag_reason, auto_closed_at, no_lunch_reason,
          lunch_review_status, lunch_review_reason, lunch_review_minutes)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
       RETURNING id, user_id, location_id, type, ts, source, geofence_pass, flagged, flag_reason, auto_closed_at`,
      [
        input.userId, input.locationId, input.type, ts, input.source,
        input.ip ?? null, input.lat ?? null, input.lng ?? null,
        input.geofencePass ?? null,
        !!input.flagged, input.flagReason ?? null, input.autoClosedAt ?? null,
        input.noLunchReason ?? null,
        input.lunchReviewStatus ?? null,
        input.lunchReviewReason ?? null,
        input.lunchReviewMinutes ?? null,
      ]
    );
    return r.rows[0] as PunchRow;
  };

  if (input.client) return exec(input.client);
  return withTransaction(async client => exec(client));
}

/**
 * Decide whether a clock_out attempt requires the employee to attest about
 * lunch. A "shift" is the open span starting at the most recent clock_in
 * (after the most recent clock_out or beginning of history).
 *
 * Two trigger conditions, both gated by shift duration ≥ LUNCH_ATTESTATION_THRESHOLD_HOURS:
 *   - reason='no_lunch'    — no lunch_start in the shift
 *   - reason='short_lunch' — lunch was recorded but total < SHORT_LUNCH_THRESHOLD_MINUTES
 *
 * Returns hours_worked (decimal) for UX copy and lunch_minutes for the
 * short-lunch case ("Lunch was only 7 minutes").
 */
export const LUNCH_ATTESTATION_THRESHOLD_HOURS = 7;
export const SHORT_LUNCH_THRESHOLD_MINUTES = 15;

export interface LunchAttestationCheck {
  required: boolean;
  reason: LunchReviewReason | null;
  hours_worked: number;
  lunch_minutes: number | null;
  shift_start: Date | null;
}

export async function shiftRequiresLunchAttestation(
  userId: number,
  now: Date = new Date(),
  client?: PoolClient,
): Promise<LunchAttestationCheck> {
  // Walk back from most recent punch and find the open shift's clock_in.
  // We look at the last ~36 hours which comfortably covers any single
  // shift even with auto-close edge cases. Pass `client` to read inside
  // an active transaction.
  const sql = `SELECT type, ts FROM timeclock.punches
     WHERE user_id = $1 AND ts >= $2
     ORDER BY ts ASC`;
  const params = [userId, new Date(now.getTime() - 36 * 60 * 60 * 1000)];
  const result = client
    ? await client.query<{ type: PunchType; ts: Date }>(sql, params)
    : await query<{ type: PunchType; ts: Date }>(sql, params);
  const rows = result.rows;
  // Find the LAST clock_in that hasn't been closed by a subsequent clock_out.
  // Track every (lunch_start, lunch_end) pair within the open shift so we
  // can sum recorded lunch minutes for the short-lunch trigger. Lone
  // lunch_start without a matching lunch_end (e.g. user forgot to clock
  // back in) leaves lunch effectively unmeasured — treated as 0 min for
  // safety, which surfaces it as short_lunch (manager will catch it).
  let shiftStart: Date | null = null;
  let lunchOpenAt: Date | null = null;
  let lunchTotalMs = 0;
  let lunchSegmentCount = 0;
  for (const r of rows) {
    if (r.type === 'clock_in') {
      shiftStart = new Date(r.ts);
      lunchOpenAt = null;
      lunchTotalMs = 0;
      lunchSegmentCount = 0;
    } else if (r.type === 'clock_out') {
      shiftStart = null;
      lunchOpenAt = null;
      lunchTotalMs = 0;
      lunchSegmentCount = 0;
    } else if (r.type === 'lunch_start' && shiftStart) {
      lunchOpenAt = new Date(r.ts);
      lunchSegmentCount += 1;
    } else if (r.type === 'lunch_end' && shiftStart && lunchOpenAt) {
      lunchTotalMs += new Date(r.ts).getTime() - lunchOpenAt.getTime();
      lunchOpenAt = null;
    }
  }
  if (!shiftStart) {
    return {
      required: false,
      reason: null,
      hours_worked: 0,
      lunch_minutes: null,
      shift_start: null,
    };
  }
  const hours = (now.getTime() - shiftStart.getTime()) / (1000 * 60 * 60);
  const overThreshold = hours >= LUNCH_ATTESTATION_THRESHOLD_HOURS;
  const lunchMinutes = Math.round(lunchTotalMs / 60_000);

  let reason: LunchReviewReason | null = null;
  let lunch_minutes: number | null = null;
  if (overThreshold) {
    if (lunchSegmentCount === 0) {
      reason = 'no_lunch';
      lunch_minutes = null;
    } else if (lunchMinutes < SHORT_LUNCH_THRESHOLD_MINUTES) {
      reason = 'short_lunch';
      lunch_minutes = lunchMinutes;
    }
  }

  return {
    required: reason !== null,
    reason,
    hours_worked: Math.round(hours * 10) / 10,
    lunch_minutes,
    shift_start: shiftStart,
  };
}
