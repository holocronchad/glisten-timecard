// Pair raw punches into shift segments and total worked time.
// Treats unpaired clock_in (no clock_out) as "still on the clock" — caller
// decides whether to include the open segment up to NOW.

import type { PunchType } from './punches';

export interface PunchLite {
  id: number;
  user_id: number;
  type: PunchType;
  ts: string | Date;
  flagged?: boolean;
  auto_closed_at?: Date | null;
  // location_id reflects which PIN was used to clock in:
  //   number → office PIN (geofence-bound)
  //   null   → WFH PIN (no geofence)
  // Required for rate-split payroll math.
  location_id?: number | null;
  // Lunch-review deduction in seconds (migration 015). Lives on the
  // clock_out punch row. When Dr. Dawood rejects a no-lunch / short-lunch
  // shift from the manager queue, this becomes 1800 (30 min) — and that
  // many minutes come off the paid segment closed by this punch. Approve
  // or pending = 0. Carried onto Segment.lunch_review_deduction_minutes
  // so every downstream consumer (totalMinutes / totalsByDay /
  // splitMinutes / computeRateBreakdown) subtracts it automatically.
  // (Anomaly scoring in reviewDays() deliberately uses RAW duration so
  // a 12h shift still flags as long even after the deduction.)
  lunch_review_deduction_seconds?: number | null;
}

export interface Segment {
  user_id: number;
  start: Date;
  end: Date;
  paid: boolean;
  open: boolean;
  source_in_id: number;
  source_out_id: number | null;
  flagged: boolean;
  auto_closed: boolean;
  // Inherited from the clock_in punch that opened this segment.
  // null = WFH (paid at WFH rate); number = office id (paid at office rate).
  location_id: number | null;
  // Pay deduction in minutes (migration 015). Non-zero only on the paid
  // segment closed by a clock_out punch whose lunch review was rejected
  // (30 min). All other segments are 0. See PunchLite comment above.
  lunch_review_deduction_minutes: number;
}

const PAIR: Record<PunchType, PunchType> = {
  clock_in: 'clock_out',
  clock_out: 'clock_in',
  lunch_start: 'lunch_end',
  lunch_end: 'lunch_start',
};

/**
 * Walk punches in chronological order, build paid (worked) and unpaid (lunch)
 * segments. Open segments at the end use `now` as a soft end (open=true, end is
 * the wall-clock end for hours rendering only — not stored).
 */
export function buildSegments(punches: PunchLite[], now: Date = new Date()): Segment[] {
  const sorted = [...punches].sort(
    (a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime(),
  );
  const segments: Segment[] = [];
  let openIn: PunchLite | null = null;
  let openLunch: PunchLite | null = null;

  // Convert the deduction-seconds field (on a clock_out punch) into the
  // minute value that gets stamped on the matching paid Segment. Round
  // to whole minutes — the same precision as totalMinutes/totalsByDay
  // use throughout the rest of the app.
  const deductionMinutesOf = (p: PunchLite): number =>
    Math.max(0, Math.round((p.lunch_review_deduction_seconds ?? 0) / 60));

  for (const p of sorted) {
    if (p.type === 'clock_in') {
      // Close any prior open shift defensively (shouldn't happen with state machine)
      if (openIn) {
        segments.push({
          user_id: p.user_id,
          start: new Date(openIn.ts),
          end: new Date(p.ts),
          paid: true,
          open: false,
          source_in_id: openIn.id,
          source_out_id: null,
          flagged: true,
          auto_closed: false,
          location_id: openIn.location_id ?? null,
          // No clock_out closed this segment, so no review row exists → 0.
          lunch_review_deduction_minutes: 0,
        });
      }
      openIn = p;
      openLunch = null;
    } else if (p.type === 'clock_out') {
      if (openIn) {
        segments.push({
          user_id: p.user_id,
          start: new Date(openIn.ts),
          end: new Date(p.ts),
          paid: true,
          open: false,
          source_in_id: openIn.id,
          source_out_id: p.id,
          flagged: !!p.flagged,
          auto_closed: !!p.auto_closed_at,
          // Segment's rate bucket is decided by the OPENING punch (clock_in/lunch_end);
          // an employee who clocked in WFH and clocks out from the office still
          // gets paid the WFH rate for that segment.
          location_id: openIn.location_id ?? null,
          // The clock_out punch is the row Dr. Dawood reviews. If she
          // rejected its lunch review, deduct here (30 min by default).
          lunch_review_deduction_minutes: deductionMinutesOf(p),
        });
        openIn = null;
      }
    } else if (p.type === 'lunch_start') {
      if (openIn) {
        // Close current paid segment at lunch start
        segments.push({
          user_id: p.user_id,
          start: new Date(openIn.ts),
          end: new Date(p.ts),
          paid: true,
          open: false,
          source_in_id: openIn.id,
          source_out_id: p.id,
          flagged: false,
          auto_closed: false,
          location_id: openIn.location_id ?? null,
          // Pre-lunch segment isn't the reviewed-shift closer; deduction lives
          // on the clock_out segment instead.
          lunch_review_deduction_minutes: 0,
        });
        openIn = null;
        openLunch = p;
      }
    } else if (p.type === 'lunch_end') {
      if (openLunch) {
        segments.push({
          user_id: p.user_id,
          start: new Date(openLunch.ts),
          end: new Date(p.ts),
          paid: false,
          open: false,
          source_in_id: openLunch.id,
          source_out_id: p.id,
          flagged: false,
          auto_closed: false,
          // Lunch is unpaid so location doesn't matter for pay; preserve the
          // rate context for any UI that wants to color the segment.
          location_id: openLunch.location_id ?? null,
          // Unpaid segment — deduction is meaningless here (filter(paid) drops it).
          lunch_review_deduction_minutes: 0,
        });
        openLunch = null;
      }
      // Treat lunch_end as a new clock_in (employee back on the clock)
      openIn = p;
    }
  }

  if (openIn) {
    segments.push({
      user_id: openIn.user_id,
      start: new Date(openIn.ts),
      end: now,
      paid: true,
      open: true,
      source_in_id: openIn.id,
      source_out_id: null,
      flagged: false,
      auto_closed: false,
      location_id: openIn.location_id ?? null,
      // Still on the clock — no review has happened yet.
      lunch_review_deduction_minutes: 0,
    });
  }

  return segments;
}

export interface DailyTotal {
  date: string; // yyyy-mm-dd in displayTz
  worked_minutes: number;
  open: boolean;
}

// Net minutes for a single paid segment — raw duration minus the
// lunch-review deduction (clamped to never go negative).
function paidMinutesOf(s: Segment): number {
  const raw = Math.max(0, Math.round((s.end.getTime() - s.start.getTime()) / 60000));
  return Math.max(0, raw - s.lunch_review_deduction_minutes);
}

export function totalsByDay(segments: Segment[], displayTz = 'America/Phoenix'): DailyTotal[] {
  const buckets = new Map<string, DailyTotal>();
  for (const s of segments) {
    if (!s.paid) continue;
    const key = formatDate(s.start, displayTz);
    const minutes = paidMinutesOf(s);
    const existing = buckets.get(key) ?? { date: key, worked_minutes: 0, open: false };
    existing.worked_minutes += minutes;
    if (s.open) existing.open = true;
    buckets.set(key, existing);
  }
  return [...buckets.values()].sort((a, b) => a.date.localeCompare(b.date));
}

export function totalMinutes(segments: Segment[]): number {
  return segments
    .filter((s) => s.paid)
    .reduce((acc, s) => acc + paidMinutesOf(s), 0);
}

// Office vs WFH split for a set of segments. Mirrors the inline math in
// /manage/period and the web Me.tsx split — extracted so the lunch-review
// deduction is honored once in shared code instead of duplicated.
export function splitMinutes(segments: Segment[]): { office: number; wfh: number } {
  let office = 0;
  let wfh = 0;
  for (const s of segments) {
    if (!s.paid) continue;
    const m = paidMinutesOf(s);
    if (s.location_id == null) wfh += m;
    else office += m;
  }
  return { office, wfh };
}

function formatDate(d: Date, tz: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(d);
  const y = parts.find((p) => p.type === 'year')!.value;
  const m = parts.find((p) => p.type === 'month')!.value;
  const day = parts.find((p) => p.type === 'day')!.value;
  return `${y}-${m}-${day}`;
}
