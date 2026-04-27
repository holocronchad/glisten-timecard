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
    });
  }

  return segments;
}

export interface DailyTotal {
  date: string; // yyyy-mm-dd in displayTz
  worked_minutes: number;
  open: boolean;
}

export function totalsByDay(segments: Segment[], displayTz = 'America/Phoenix'): DailyTotal[] {
  const buckets = new Map<string, DailyTotal>();
  for (const s of segments) {
    if (!s.paid) continue;
    const key = formatDate(s.start, displayTz);
    const minutes = Math.max(0, Math.round((s.end.getTime() - s.start.getTime()) / 60000));
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
    .reduce(
      (acc, s) => acc + Math.max(0, Math.round((s.end.getTime() - s.start.getTime()) / 60000)),
      0,
    );
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
