// Mirror of server/src/services/hours.ts, kept in sync by hand.
// Pairs raw punches into worked segments + computes daily/period totals.

export type PunchType = 'clock_in' | 'clock_out' | 'lunch_start' | 'lunch_end';

export interface PunchLite {
  id: number;
  type: PunchType;
  ts: string | Date;
  flagged?: boolean;
}

export interface Segment {
  start: Date;
  end: Date;
  paid: boolean;
  open: boolean;
  flagged: boolean;
}

export function buildSegments(punches: PunchLite[], now: Date = new Date()): Segment[] {
  const sorted = [...punches].sort(
    (a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime(),
  );
  const segments: Segment[] = [];
  let openIn: PunchLite | null = null;
  let openLunch: PunchLite | null = null;

  for (const p of sorted) {
    if (p.type === 'clock_in') {
      if (openIn) {
        segments.push({
          start: new Date(openIn.ts),
          end: new Date(p.ts),
          paid: true,
          open: false,
          flagged: true,
        });
      }
      openIn = p;
      openLunch = null;
    } else if (p.type === 'clock_out') {
      if (openIn) {
        segments.push({
          start: new Date(openIn.ts),
          end: new Date(p.ts),
          paid: true,
          open: false,
          flagged: !!p.flagged,
        });
        openIn = null;
      }
    } else if (p.type === 'lunch_start') {
      if (openIn) {
        segments.push({
          start: new Date(openIn.ts),
          end: new Date(p.ts),
          paid: true,
          open: false,
          flagged: false,
        });
        openIn = null;
        openLunch = p;
      }
    } else if (p.type === 'lunch_end') {
      if (openLunch) {
        segments.push({
          start: new Date(openLunch.ts),
          end: new Date(p.ts),
          paid: false,
          open: false,
          flagged: false,
        });
        openLunch = null;
      }
      openIn = p;
    }
  }

  if (openIn) {
    segments.push({
      start: new Date(openIn.ts),
      end: now,
      paid: true,
      open: true,
      flagged: false,
    });
  }
  return segments;
}

export interface DailyTotal {
  date: string;
  worked_minutes: number;
  open: boolean;
}

export function totalsByDay(
  segments: Segment[],
  displayTz = 'America/Phoenix',
): DailyTotal[] {
  const buckets = new Map<string, DailyTotal>();
  for (const s of segments) {
    if (!s.paid) continue;
    const key = formatDateKey(s.start, displayTz);
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

function formatDateKey(d: Date, tz: string): string {
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
