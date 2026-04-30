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
 */
export async function getLatestPunch(userId: number): Promise<PunchRow | null> {
  const { rows } = await query<PunchRow>(
    `SELECT id, user_id, location_id, type, ts, source, geofence_pass, flagged, flag_reason, auto_closed_at
     FROM timeclock.punches
     WHERE user_id = $1
     ORDER BY ts DESC
     LIMIT 1`,
    [userId]
  );
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
  client?: PoolClient;
}

export async function recordPunch(input: RecordPunchInput): Promise<PunchRow> {
  const ts = input.ts ?? new Date();
  const exec = async (q: any) => {
    const r = await q.query(
      `INSERT INTO timeclock.punches
         (user_id, location_id, type, ts, source, ip, lat, lng, geofence_pass,
          flagged, flag_reason, auto_closed_at, no_lunch_reason)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
       RETURNING id, user_id, location_id, type, ts, source, geofence_pass, flagged, flag_reason, auto_closed_at`,
      [
        input.userId, input.locationId, input.type, ts, input.source,
        input.ip ?? null, input.lat ?? null, input.lng ?? null,
        input.geofencePass ?? null,
        !!input.flagged, input.flagReason ?? null, input.autoClosedAt ?? null,
        input.noLunchReason ?? null,
      ]
    );
    return r.rows[0] as PunchRow;
  };

  if (input.client) return exec(input.client);
  return withTransaction(async client => exec(client));
}

/**
 * Decide whether a clock_out attempt requires the employee to attest why
 * they didn't take a lunch break. A "shift" is defined as the open span
 * starting at the most recent clock_in (after the most recent clock_out
 * or beginning of history). If that span has no lunch_start, and it has
 * been at least `minHours` long, attestation is required.
 *
 * Returns hours_worked (decimal) for the UX copy ("you've been on the
 * clock for 8.4 hours…").
 */
export const LUNCH_ATTESTATION_THRESHOLD_HOURS = 7;

export async function shiftRequiresLunchAttestation(
  userId: number,
  now: Date = new Date(),
): Promise<{ required: boolean; hours_worked: number; shift_start: Date | null }> {
  // Walk back from most recent punch and find the open shift's clock_in.
  // We look at the last ~36 hours which comfortably covers any single
  // shift even with auto-close edge cases.
  const { rows } = await query<{ type: PunchType; ts: Date }>(
    `SELECT type, ts FROM timeclock.punches
     WHERE user_id = $1 AND ts >= $2
     ORDER BY ts ASC`,
    [userId, new Date(now.getTime() - 36 * 60 * 60 * 1000)],
  );
  // Find the LAST clock_in that hasn't been closed by a subsequent clock_out.
  let shiftStart: Date | null = null;
  let lunchSeenInShift = false;
  for (const r of rows) {
    if (r.type === 'clock_in') {
      shiftStart = new Date(r.ts);
      lunchSeenInShift = false;
    } else if (r.type === 'clock_out') {
      shiftStart = null;
      lunchSeenInShift = false;
    } else if (r.type === 'lunch_start' && shiftStart) {
      lunchSeenInShift = true;
    }
  }
  if (!shiftStart) {
    return { required: false, hours_worked: 0, shift_start: null };
  }
  const hours = (now.getTime() - shiftStart.getTime()) / (1000 * 60 * 60);
  const required = !lunchSeenInShift && hours >= LUNCH_ATTESTATION_THRESHOLD_HOURS;
  return { required, hours_worked: Math.round(hours * 10) / 10, shift_start: shiftStart };
}
