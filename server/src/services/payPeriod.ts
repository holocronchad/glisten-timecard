// Per-location pay periods. Two cadences supported:
//
//   biweekly:     fixed 14-day cycle anchored to a known Monday in the
//                 location's history. Index = integer offset from anchor.
//                 Used by Gilbert.
//
//   semi_monthly: 1st-15th and 16th-EOM of each calendar month. Period
//                 lengths vary (15-16 days, ~28 in February). Index encodes
//                 (year * 24) + (month - 1) * 2 + half, so prev/next still
//                 works as index ± 1. Used by Mesa + Glendale.
//
// All math runs in display TZ (America/Phoenix) so period boundaries don't
// drift across DST/UTC.
//
// Schema source of truth: timeclock.pay_schedules (migration 010).
// Schedules are cached in-process for the lifetime of the process; locations
// + schedules essentially never change at runtime, and a pm2 restart clears
// the cache. If a schedule is hot-edited via SQL, restart pm2 to pick it up.

import { config } from '../config';
import { query } from '../db';

const DAY_MS = 24 * 60 * 60 * 1000;

// ─── Schedule loading ──────────────────────────────────────────────────────

export type ScheduleType = 'biweekly' | 'semi_monthly';

export interface PaySchedule {
  locationId: number;
  scheduleType: ScheduleType;
  anchorDate?: string; // YYYY-MM-DD, biweekly only
  lengthDays?: number; // biweekly only
}

interface ScheduleRow {
  location_id: number;
  schedule_type: ScheduleType;
  anchor_date: Date | null;
  length_days: number | null;
}

let scheduleCache: Map<number, PaySchedule> | null = null;

async function loadSchedules(): Promise<Map<number, PaySchedule>> {
  if (scheduleCache) return scheduleCache;
  const { rows } = await query<ScheduleRow>(
    `SELECT location_id, schedule_type, anchor_date, length_days
     FROM timeclock.pay_schedules`,
  );
  const map = new Map<number, PaySchedule>();
  for (const r of rows) {
    map.set(r.location_id, {
      locationId: r.location_id,
      scheduleType: r.schedule_type,
      anchorDate: r.anchor_date ? toIsoDate(r.anchor_date) : undefined,
      lengthDays: r.length_days ?? undefined,
    });
  }
  scheduleCache = map;
  return map;
}

/** Force-reload from DB on next access. Useful in tests + after admin edits. */
export function clearScheduleCache(): void {
  scheduleCache = null;
}

function toIsoDate(d: Date): string {
  // Drop time + TZ — schedule anchor is a calendar date, not an instant.
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Public lookup. Throws if location has no schedule (forces explicit setup). */
export async function getScheduleForLocation(locationId: number): Promise<PaySchedule> {
  const schedules = await loadSchedules();
  const s = schedules.get(locationId);
  if (!s) {
    throw new Error(
      `No pay schedule for location_id=${locationId}. Run migration 010_pay_schedules.sql or seed timeclock.pay_schedules manually.`,
    );
  }
  return s;
}

// ─── TZ helpers (unchanged from prior version) ─────────────────────────────

function offsetForTz(tz: string, date: Date): string {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    timeZoneName: 'longOffset',
  });
  const parts = dtf.formatToParts(date);
  const tzPart = parts.find((p) => p.type === 'timeZoneName')?.value ?? 'GMT+00:00';
  const m = tzPart.match(/GMT([+-]\d{2}:\d{2})/);
  return m ? m[1] : '+00:00';
}

function startOfDayInTz(date: Date, tz: string): Date {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const y = parts.find((p) => p.type === 'year')!.value;
  const m = parts.find((p) => p.type === 'month')!.value;
  const d = parts.find((p) => p.type === 'day')!.value;
  return new Date(`${y}-${m}-${d}T00:00:00${offsetForTz(tz, date)}`);
}

function localYmdInTz(date: Date, tz: string): { year: number; month: number; day: number } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  return {
    year: parseInt(parts.find((p) => p.type === 'year')!.value, 10),
    month: parseInt(parts.find((p) => p.type === 'month')!.value, 10),
    day: parseInt(parts.find((p) => p.type === 'day')!.value, 10),
  };
}

function dateAtMidnightInTz(year: number, month1to12: number, day: number, tz: string): Date {
  // Build a Date from local Y-M-D using the TZ's offset.
  const probe = new Date(Date.UTC(year, month1to12 - 1, day, 12, 0, 0));
  const offset = offsetForTz(tz, probe);
  const mm = String(month1to12).padStart(2, '0');
  const dd = String(day).padStart(2, '0');
  return new Date(`${year}-${mm}-${dd}T00:00:00${offset}`);
}

function lastDayOfMonth(year: number, month1to12: number): number {
  return new Date(Date.UTC(year, month1to12, 0)).getUTCDate();
}

// ─── Public period type ────────────────────────────────────────────────────

export interface PayPeriod {
  index: number;
  start: Date;        // inclusive (midnight in display TZ)
  end: Date;          // exclusive (midnight of the day AFTER period end)
  label: string;      // e.g., "2026-04-20 → 2026-05-03"
  scheduleType: ScheduleType;
  locationId: number;
}

// ─── Biweekly math (unchanged behavior, now schedule-driven) ──────────────

export function biweeklyPeriodForDate(
  schedule: PaySchedule,
  date: Date,
  tz: string,
): PayPeriod {
  const anchorIso = schedule.anchorDate ?? config.payPeriodAnchor;
  const lengthDays = schedule.lengthDays ?? config.payPeriodLengthDays;
  const anchor = startOfDayInTz(new Date(`${anchorIso}T12:00:00Z`), tz);
  const cursor = startOfDayInTz(date, tz);
  const diffDays = Math.floor((cursor.getTime() - anchor.getTime()) / DAY_MS);
  const index = Math.floor(diffDays / lengthDays);
  return biweeklyPeriodAtIndex(schedule, index, tz);
}

export function biweeklyPeriodAtIndex(
  schedule: PaySchedule,
  index: number,
  tz: string,
): PayPeriod {
  const anchorIso = schedule.anchorDate ?? config.payPeriodAnchor;
  const lengthDays = schedule.lengthDays ?? config.payPeriodLengthDays;
  const anchor = startOfDayInTz(new Date(`${anchorIso}T12:00:00Z`), tz);
  const start = new Date(anchor.getTime() + index * lengthDays * DAY_MS);
  const end = new Date(start.getTime() + lengthDays * DAY_MS);
  return {
    index,
    start,
    end,
    label: makeLabel(start, end),
    scheduleType: 'biweekly',
    locationId: schedule.locationId,
  };
}

// ─── Semi-monthly math ─────────────────────────────────────────────────────
//
// Index encoding: (year * 24) + ((month - 1) * 2) + half
//   half = 0 → 1st through 15th of that month
//   half = 1 → 16th through last day of that month
//
// Properties:
//   • index increments by exactly 1 between adjacent half-months
//   • prev/next ±1 works without special-casing month rollover
//   • year-2026 indices fall around 48624..48647 — distinct from biweekly
//     small integers, so the two index spaces don't collide visually
//
// Decoding:
//   year       = idx ÷ 24            (integer division)
//   monthHalf  = idx mod 24
//   month      = ⌊monthHalf ÷ 2⌋ + 1
//   half       = monthHalf mod 2

export function semiMonthlyEncode(year: number, month1to12: number, half: 0 | 1): number {
  return year * 24 + (month1to12 - 1) * 2 + half;
}

export function semiMonthlyDecode(index: number): { year: number; month: number; half: 0 | 1 } {
  // JS modulo can be negative for negative inputs; we clamp by branch.
  const year = Math.floor(index / 24);
  const monthHalf = ((index % 24) + 24) % 24;
  const half = (monthHalf % 2) as 0 | 1;
  const month = Math.floor((monthHalf - half) / 2) + 1;
  return { year, month, half };
}

export function semiMonthlyPeriodAtIndex(
  schedule: PaySchedule,
  index: number,
  tz: string,
): PayPeriod {
  const { year, month, half } = semiMonthlyDecode(index);
  let startDay: number;
  let endDay: number;
  if (half === 0) {
    startDay = 1;
    endDay = 15;
  } else {
    startDay = 16;
    endDay = lastDayOfMonth(year, month);
  }
  const start = dateAtMidnightInTz(year, month, startDay, tz);
  // exclusive end = midnight of the day AFTER endDay
  const dayAfter = endDay + 1;
  let endYear = year;
  let endMonth = month;
  if (dayAfter > lastDayOfMonth(year, month)) {
    endMonth = month + 1;
    if (endMonth > 12) {
      endMonth = 1;
      endYear = year + 1;
    }
    var endDayActual = 1;
  } else {
    var endDayActual = dayAfter;
  }
  const end = dateAtMidnightInTz(endYear, endMonth, endDayActual, tz);
  return {
    index,
    start,
    end,
    label: makeLabel(start, end),
    scheduleType: 'semi_monthly',
    locationId: schedule.locationId,
  };
}

export function semiMonthlyPeriodForDate(
  schedule: PaySchedule,
  date: Date,
  tz: string,
): PayPeriod {
  const { year, month, day } = localYmdInTz(date, tz);
  const half: 0 | 1 = day <= 15 ? 0 : 1;
  const index = semiMonthlyEncode(year, month, half);
  return semiMonthlyPeriodAtIndex(schedule, index, tz);
}

// ─── Public API ────────────────────────────────────────────────────────────

function makeLabel(start: Date, endExclusive: Date, tz: string = config.timezone): string {
  // Format in display TZ so the printed label matches the period's calendar
  // boundaries (e.g., Gilbert period ending 5/3 inclusive shouldn't render
  // as 5/4 just because midnight Phoenix is 7am UTC).
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const startYmd = fmt.format(start);
  const lastDay = new Date(endExclusive.getTime() - 1);
  const lastYmd = fmt.format(lastDay);
  return `${startYmd} → ${lastYmd}`;
}

/** Current period for a location at the given moment. */
export async function periodForLocation(
  locationId: number,
  date: Date = new Date(),
  tz: string = config.timezone,
): Promise<PayPeriod> {
  const schedule = await getScheduleForLocation(locationId);
  return schedule.scheduleType === 'biweekly'
    ? biweeklyPeriodForDate(schedule, date, tz)
    : semiMonthlyPeriodForDate(schedule, date, tz);
}

/** Period at a specific index for a location. Index semantics depend on schedule type. */
export async function periodByIndexForLocation(
  locationId: number,
  index: number,
  tz: string = config.timezone,
): Promise<PayPeriod> {
  const schedule = await getScheduleForLocation(locationId);
  return schedule.scheduleType === 'biweekly'
    ? biweeklyPeriodAtIndex(schedule, index, tz)
    : semiMonthlyPeriodAtIndex(schedule, index, tz);
}

/** Resolve a user's home location, then return that location's current period. */
export async function periodForUser(
  userId: number,
  date: Date = new Date(),
  tz: string = config.timezone,
): Promise<PayPeriod | null> {
  const { rows } = await query<{ home_location_id: number | null }>(
    `SELECT home_location_id FROM timeclock.users WHERE id = $1`,
    [userId],
  );
  if (rows.length === 0 || rows[0].home_location_id === null) return null;
  return periodForLocation(rows[0].home_location_id, date, tz);
}

/**
 * Default location used when an endpoint has no location filter (e.g., the
 * "All" view on the manager dashboard). Picks the location with the largest
 * active+approved+track_hours roster — currently Gilbert. This makes the "All"
 * dashboard's headline period meaningful even though semi-monthly + biweekly
 * locations don't share period boundaries.
 */
export async function defaultLocationId(): Promise<number> {
  const { rows } = await query<{ home_location_id: number; cnt: number }>(
    `SELECT home_location_id, COUNT(*)::int AS cnt
     FROM timeclock.users
     WHERE active = true AND track_hours = true AND approved = true
       AND home_location_id IS NOT NULL
     GROUP BY home_location_id
     ORDER BY cnt DESC
     LIMIT 1`,
  );
  if (rows.length > 0) return rows[0].home_location_id;
  // Fallback to lowest-id active location if no users have home_location set yet.
  const { rows: locs } = await query<{ id: number }>(
    `SELECT id FROM timeclock.locations WHERE active = true ORDER BY id ASC LIMIT 1`,
  );
  if (locs.length > 0) return locs[0].id;
  throw new Error('No active locations defined.');
}
