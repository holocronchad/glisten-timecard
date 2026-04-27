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
 * State machine:
 *   no punches yet                       -> [clock_in]
 *   last = clock_in                      -> [clock_out, lunch_start]
 *   last = lunch_start                   -> [lunch_end]
 *   last = lunch_end                     -> [clock_out, lunch_start]   (rare but allowed: 2nd lunch)
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
  client?: PoolClient;
}

export async function recordPunch(input: RecordPunchInput): Promise<PunchRow> {
  const ts = input.ts ?? new Date();
  const exec = async (q: any) => {
    const r = await q.query(
      `INSERT INTO timeclock.punches
         (user_id, location_id, type, ts, source, ip, lat, lng, geofence_pass,
          flagged, flag_reason, auto_closed_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       RETURNING id, user_id, location_id, type, ts, source, geofence_pass, flagged, flag_reason, auto_closed_at`,
      [
        input.userId, input.locationId, input.type, ts, input.source,
        input.ip ?? null, input.lat ?? null, input.lng ?? null,
        input.geofencePass ?? null,
        !!input.flagged, input.flagReason ?? null, input.autoClosedAt ?? null,
      ]
    );
    return r.rows[0] as PunchRow;
  };

  if (input.client) return exec(input.client);
  return withTransaction(async client => exec(client));
}
