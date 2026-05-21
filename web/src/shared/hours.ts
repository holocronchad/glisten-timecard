// Mirror of server/src/services/hours.ts, kept in sync by hand.
// Pairs raw punches into worked segments + computes daily/period totals.

export type PunchType = 'clock_in' | 'clock_out' | 'lunch_start' | 'lunch_end';

export interface PunchLite {
  id: number;
  type: PunchType;
  ts: string | Date;
  flagged?: boolean;
  // location_id is the office geofence the opening punch was bound to.
  // null = WFH PIN was used (no geofence). Required so the /me view can
  // split office-rate vs WFH-rate hours for dual-PIN employees like Filza.
  location_id?: number | null;
  // Lunch-review deduction in seconds (migration 015). Set to 1800 (30 min)
  // on a clock_out punch whose lunch review Dr. Dawood rejected — that
  // many minutes come off this shift's paid time. Mirrors server PunchLite.
  lunch_review_deduction_seconds?: number | null;
}

export interface Segment {
  start: Date;
  end: Date;
  paid: boolean;
  open: boolean;
  flagged: boolean;
  // Inherited from the OPENING punch of this segment (clock_in or lunch_end).
  // Matches server-side payroll bucket assignment: null → WFH rate,
  // non-null → office rate.
  location_id: number | null;
  // Pay deduction in minutes (migration 015). Non-zero only on the paid
  // segment closed by a rejected-lunch-review clock_out. Subtracted by
  // totalMinutes / totalsByDay / splitMinutes.
  lunch_review_deduction_minutes: number;
}

export function buildSegments(punches: PunchLite[], now: Date = new Date()): Segment[] {
  const sorted = [...punches].sort(
    (a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime(),
  );
  const segments: Segment[] = [];
  let openIn: PunchLite | null = null;
  let openLunch: PunchLite | null = null;

  const locOf = (p: PunchLite): number | null =>
    p.location_id === undefined ? null : p.location_id;
  const deductionMinutesOf = (p: PunchLite): number =>
    Math.max(0, Math.round((p.lunch_review_deduction_seconds ?? 0) / 60));

  for (const p of sorted) {
    if (p.type === 'clock_in') {
      if (openIn) {
        segments.push({
          start: new Date(openIn.ts),
          end: new Date(p.ts),
          paid: true,
          open: false,
          flagged: true,
          location_id: locOf(openIn),
          lunch_review_deduction_minutes: 0,
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
          location_id: locOf(openIn),
          // Reviewed clock_out → 30 min off this segment on reject.
          lunch_review_deduction_minutes: deductionMinutesOf(p),
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
          location_id: locOf(openIn),
          lunch_review_deduction_minutes: 0,
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
          location_id: locOf(openLunch),
          lunch_review_deduction_minutes: 0,
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
      location_id: locOf(openIn),
      lunch_review_deduction_minutes: 0,
    });
  }
  return segments;
}

export interface DailyTotal {
  date: string;
  worked_minutes: number;
  open: boolean;
}

// Net minutes for one paid segment — raw duration minus lunch-review
// deduction (migration 015), clamped to never go negative.
function paidMinutesOf(s: Segment): number {
  const raw = Math.max(0, Math.round((s.end.getTime() - s.start.getTime()) / 60000));
  return Math.max(0, raw - s.lunch_review_deduction_minutes);
}

export function totalsByDay(
  segments: Segment[],
  displayTz = 'America/Phoenix',
): DailyTotal[] {
  const buckets = new Map<string, DailyTotal>();
  for (const s of segments) {
    if (!s.paid) continue;
    const key = formatDateKey(s.start, displayTz);
    const minutes = paidMinutesOf(s);
    const existing = buckets.get(key) ?? { date: key, worked_minutes: 0, open: false };
    existing.worked_minutes += minutes;
    if (s.open) existing.open = true;
    buckets.set(key, existing);
  }
  return [...buckets.values()].sort((a, b) => a.date.localeCompare(b.date));
}

// Decimal-hour string for payroll (e.g. 495 min → "8.25"). Two decimal
// places = hundredths of an hour, the convention Dr. Dawood's payroll uses
// and the EXACT format the payroll CSV already emits
// (`(minutes / 60).toFixed(2)` in server/src/services/payroll.ts rowsToCsv).
// Display-only — never feeds a pay computation.
export function decimalHours(minutes: number): string {
  return (minutes / 60).toFixed(2);
}

export function totalMinutes(segments: Segment[]): number {
  return segments
    .filter((s) => s.paid)
    .reduce((acc, s) => acc + paidMinutesOf(s), 0);
}

// Office vs WFH split for the running total. A segment with location_id===null
// was opened via the WFH PIN (e.g. Filza's 0329); anything else is office.
// Matches server-side payroll bucket rule in services/payroll.ts. Honors
// the lunch-review deduction via paidMinutesOf.
export function splitMinutes(segments: Segment[]): { office: number; wfh: number } {
  let office = 0;
  let wfh = 0;
  for (const s of segments) {
    if (!s.paid) continue;
    const m = paidMinutesOf(s);
    if (s.location_id === null) wfh += m;
    else office += m;
  }
  return { office, wfh };
}

// Total deduction across a set of segments — used by Me/Period views to
// show employees "your hours include a 30-min lunch-review deduction"
// when applicable.
export function totalDeductionMinutes(segments: Segment[]): number {
  return segments
    .filter((s) => s.paid)
    .reduce((acc, s) => acc + s.lunch_review_deduction_minutes, 0);
}

export function formatDateKey(d: Date, tz: string): string {
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
