// Anomaly detection — surfaces the 5-10 things across a pay period that need
// a manager's eyes. Consumed by:
//   - /manage/period (Feature 3 payroll sign screen → row-level flags)
//   - /manage/brief  (Feature 1 morning brief → top-N urgent items)
//
// Design principles:
//   - Stateless. Caller fetches punches + computes baseline; we score.
//   - Per-day-per-employee verdict: clean OR list of anomalies.
//   - Severity drives sort order so the most urgent items rise to the top.
//   - All time math in America/Phoenix (fixed UTC-7, no DST).

import { buildSegments, totalMinutes, type PunchLite, type Segment } from './hours';

export type AnomalyType =
  | 'long_shift' // worked >12h on the day
  | 'off_time_in' // clock-in deviates >90min from 14-day baseline for that user
  | 'wrong_office' // punched at a non-home-office
  | 'open_shift' // shift never closed (still open past closing window)
  | 'no_lunch' // 7+h shift with no lunch break logged
  | 'missed_punch_pending'; // unresolved missed-punch request for that day

export type Severity = 'high' | 'medium' | 'low';

export interface Anomaly {
  type: AnomalyType;
  severity: Severity;
  message: string; // human-readable, ready to render
  context?: Record<string, unknown>;
}

export interface DayReview {
  date: string; // YYYY-MM-DD anchored to America/Phoenix
  worked_minutes: number;
  open: boolean;
  anomalies: Anomaly[];
  is_clean: boolean;
}

const TZ = 'America/Phoenix';
const LONG_SHIFT_MINUTES = 12 * 60;
const OFF_TIME_THRESHOLD_MINUTES = 90;
const NO_LUNCH_SHIFT_MINUTES = 7 * 60;
const OPEN_SHIFT_OVERRUN_MINUTES = 16 * 60; // open >16h since clock-in = stuck open

// AZ is fixed UTC-7 year-round (no DST). Use this directly for date-only math.
function azDateKey(d: Date): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(d);
  const y = parts.find((p) => p.type === 'year')!.value;
  const m = parts.find((p) => p.type === 'month')!.value;
  const day = parts.find((p) => p.type === 'day')!.value;
  return `${y}-${m}-${day}`;
}

// Minutes past AZ midnight (e.g. 8:30am AZ = 510)
function azMinutesIntoDay(d: Date): number {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: TZ,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  const [hh, mm] = fmt.format(d).split(':').map(Number);
  return hh * 60 + mm;
}

function azDayOfWeek(d: Date): number {
  const w = new Intl.DateTimeFormat('en-US', {
    timeZone: TZ,
    weekday: 'short',
  }).format(d);
  return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(w);
}

export interface ReviewInput {
  // The user being reviewed
  user: {
    id: number;
    name: string;
    home_location_id: number | null;
  };
  // Punches inside the review window (already filtered by date range).
  // Each punch must include location_id for wrong_office detection.
  punches: Array<PunchLite & { location_id: number | null }>;
  // 14-day-prior baseline: same shape, used to compute typical clock-in time.
  baselinePunches: Array<PunchLite & { location_id: number | null }>;
  // Pending missed-punch requests grouped by date (YYYY-MM-DD AZ).
  missedPendingByDate: Map<string, number>;
  // Window boundaries (used to enumerate days + decide open-shift overrun).
  windowStart: Date;
  windowEnd: Date;
  // Now (caller passes for testability).
  now?: Date;
}

export function reviewDays(input: ReviewInput): DayReview[] {
  const now = input.now ?? new Date();
  const segments = buildSegments(input.punches, now);

  // Baseline clock-in time in AZ minutes-into-day, by day-of-week.
  // Use only shifts where the first punch was a clock_in to avoid lunch
  // returns skewing the baseline.
  const baselineByDow = new Map<number, number[]>();
  const baselineSorted = [...input.baselinePunches].sort(
    (a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime(),
  );
  let lastDate: string | null = null;
  for (const p of baselineSorted) {
    if (p.type !== 'clock_in') continue;
    const d = new Date(p.ts);
    const date = azDateKey(d);
    // Only the first clock_in per day counts as "shift start"
    if (date === lastDate) continue;
    lastDate = date;
    const dow = azDayOfWeek(d);
    const min = azMinutesIntoDay(d);
    if (!baselineByDow.has(dow)) baselineByDow.set(dow, []);
    baselineByDow.get(dow)!.push(min);
  }

  function baselineFor(dow: number): number | null {
    const samples = baselineByDow.get(dow);
    if (!samples || samples.length < 2) return null; // need ≥2 samples to be meaningful
    // Median resists one outlier (e.g. someone covered an opening shift once)
    const sorted = [...samples].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 0
      ? (sorted[mid - 1] + sorted[mid]) / 2
      : sorted[mid];
  }

  // Group window segments by AZ date
  const segsByDate = new Map<string, Segment[]>();
  for (const s of segments) {
    const date = azDateKey(s.start);
    if (!segsByDate.has(date)) segsByDate.set(date, []);
    segsByDate.get(date)!.push(s);
  }

  // First-clock_in per day for off_time_in
  const firstInByDate = new Map<string, Date>();
  for (const p of input.punches) {
    if (p.type !== 'clock_in') continue;
    const ts = new Date(p.ts);
    const date = azDateKey(ts);
    const existing = firstInByDate.get(date);
    if (!existing || ts < existing) firstInByDate.set(date, ts);
  }

  // Wrong-office detection: any punch on the day with a non-NULL location_id
  // that doesn't equal the home_location_id.
  const wrongOfficeByDate = new Map<string, Set<number>>();
  if (input.user.home_location_id !== null) {
    for (const p of input.punches) {
      if (p.location_id == null) continue; // remote/WFH = legitimate
      if (p.location_id === input.user.home_location_id) continue;
      const date = azDateKey(new Date(p.ts));
      if (!wrongOfficeByDate.has(date)) {
        wrongOfficeByDate.set(date, new Set());
      }
      wrongOfficeByDate.get(date)!.add(p.location_id);
    }
  }

  // Lunch detection: days with paid shift ≥7h that have no lunch segment
  const hasLunchByDate = new Map<string, boolean>();
  for (const s of segments) {
    if (!s.paid) {
      const date = azDateKey(s.start);
      hasLunchByDate.set(date, true);
    }
  }

  // Enumerate days in window for stable iteration
  const days = enumerateAzDays(input.windowStart, input.windowEnd);
  const out: DayReview[] = [];

  for (const date of days) {
    const dayStartAz = new Date(`${date}T00:00:00-07:00`);
    const dayEndAz = new Date(dayStartAz.getTime() + 24 * 60 * 60_000);
    const daySegs = segsByDate.get(date) ?? [];
    if (daySegs.length === 0) {
      // No work that day → check pending missed-punch only
      const pending = input.missedPendingByDate.get(date) ?? 0;
      const anomalies: Anomaly[] = pending
        ? [
            {
              type: 'missed_punch_pending',
              severity: 'medium',
              message: `${pending} missed-punch request${pending > 1 ? 's' : ''} pending review`,
              context: { count: pending },
            },
          ]
        : [];
      out.push({
        date,
        worked_minutes: 0,
        open: false,
        anomalies,
        is_clean: anomalies.length === 0,
      });
      continue;
    }

    const paidMins = daySegs
      .filter((s) => s.paid)
      .reduce(
        (acc, s) => acc + Math.max(0, (s.end.getTime() - s.start.getTime()) / 60_000),
        0,
      );
    const open = daySegs.some((s) => s.open);
    const anomalies: Anomaly[] = [];

    // 1. Long shift
    if (paidMins > LONG_SHIFT_MINUTES) {
      anomalies.push({
        type: 'long_shift',
        severity: paidMins > 14 * 60 ? 'high' : 'medium',
        message: `${(paidMins / 60).toFixed(1)}h worked — verify`,
        context: { minutes: paidMins },
      });
    }

    // 2. Off-time clock-in
    const firstIn = firstInByDate.get(date);
    if (firstIn) {
      const dow = azDayOfWeek(firstIn);
      const baseline = baselineFor(dow);
      const actual = azMinutesIntoDay(firstIn);
      if (baseline !== null && Math.abs(actual - baseline) > OFF_TIME_THRESHOLD_MINUTES) {
        const earlyOrLate = actual < baseline ? 'early' : 'late';
        const deltaH = ((actual - baseline) / 60);
        anomalies.push({
          type: 'off_time_in',
          severity: Math.abs(deltaH) > 3 ? 'high' : 'low',
          message: `Clocked in ${Math.abs(deltaH).toFixed(1)}h ${earlyOrLate} vs usual`,
          context: { actual_minutes: actual, baseline_minutes: baseline, dow },
        });
      }
    }

    // 3. Wrong office
    const wrongOfficeIds = wrongOfficeByDate.get(date);
    if (wrongOfficeIds && wrongOfficeIds.size > 0) {
      anomalies.push({
        type: 'wrong_office',
        severity: 'low',
        message: `Punched at non-home office (covering shift?)`,
        context: { location_ids: [...wrongOfficeIds] },
      });
    }

    // 4. Open shift overrun
    if (open) {
      const openSeg = daySegs.find((s) => s.open);
      const ageMin = openSeg
        ? (now.getTime() - openSeg.start.getTime()) / 60_000
        : 0;
      const dayClosed = now > dayEndAz; // day is over but shift still open
      if (ageMin > OPEN_SHIFT_OVERRUN_MINUTES || dayClosed) {
        anomalies.push({
          type: 'open_shift',
          severity: 'high',
          message: dayClosed
            ? 'Shift never closed (day already ended)'
            : `Shift open ${(ageMin / 60).toFixed(1)}h — verify they clocked out`,
          context: { open_for_minutes: Math.round(ageMin) },
        });
      }
    }

    // 5. No lunch on long shift
    if (paidMins >= NO_LUNCH_SHIFT_MINUTES && !hasLunchByDate.get(date)) {
      anomalies.push({
        type: 'no_lunch',
        severity: 'low',
        message: `${(paidMins / 60).toFixed(1)}h shift with no lunch break logged`,
        context: { minutes: paidMins },
      });
    }

    // 6. Missed-punch pending for this date
    const pending = input.missedPendingByDate.get(date) ?? 0;
    if (pending > 0) {
      anomalies.push({
        type: 'missed_punch_pending',
        severity: 'medium',
        message: `${pending} missed-punch request${pending > 1 ? 's' : ''} pending review`,
        context: { count: pending },
      });
    }

    out.push({
      date,
      worked_minutes: Math.round(paidMins),
      open,
      anomalies,
      is_clean: anomalies.length === 0,
    });
  }

  return out;
}

// Sort anomalies high → medium → low
const SEVERITY_RANK: Record<Severity, number> = { high: 0, medium: 1, low: 2 };

export function sortBySeverity(anomalies: Anomaly[]): Anomaly[] {
  return [...anomalies].sort(
    (a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity],
  );
}

function enumerateAzDays(start: Date, end: Date): string[] {
  const days: string[] = [];
  const cursor = new Date(start.getTime());
  while (cursor.getTime() < end.getTime()) {
    days.push(azDateKey(cursor));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return [...new Set(days)];
}

// Exported helpers for routes that need to render dates
export const _internal = { azDateKey, azMinutesIntoDay, azDayOfWeek };
