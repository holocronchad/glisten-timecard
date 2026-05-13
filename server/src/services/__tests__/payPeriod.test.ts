// Pay-period regression tests.
//
// Source of truth: the 6 Paychex Oasis "Pay Period Schedule Report" PDFs
// pulled by Anas on 2026-04-29. Each PDF row gives a (PERIOD START,
// PERIOD END) pair; we assert that periodForDate-equivalent math returns
// matching boundaries for any date inside that range.
//
// Two cadences:
//   Gilbert  → biweekly, anchor 2026-04-20, length 14
//   Mesa     → semi-monthly (1st-15th, 16th-EOM)
//   Glendale → semi-monthly (same as Mesa per Paychex)
//
// We test the SYNC inner functions directly (biweeklyPeriodForDate,
// semiMonthlyPeriodForDate) so no DB is required. The async wrappers
// (periodForLocation) are thin DB-lookup shims around these.

import { describe, it, expect } from 'vitest';
import {
  biweeklyPeriodForDate,
  biweeklyPeriodAtIndex,
  semiMonthlyPeriodForDate,
  semiMonthlyPeriodAtIndex,
  semiMonthlyEncode,
  semiMonthlyDecode,
  type PaySchedule,
} from '../payPeriod';

const TZ = 'America/Phoenix';

const GILBERT_SCHEDULE: PaySchedule = {
  locationId: 1,
  scheduleType: 'biweekly',
  anchorDate: '2026-04-20',
  lengthDays: 14,
};

const MESA_SCHEDULE: PaySchedule = {
  locationId: 2,
  scheduleType: 'semi_monthly',
};

const GLENDALE_SCHEDULE: PaySchedule = {
  locationId: 3,
  scheduleType: 'semi_monthly',
};

// Helpers — build dates anchored at noon Phoenix to avoid TZ-edge ambiguity.
function az(ymd: string): Date {
  return new Date(`${ymd}T12:00:00-07:00`);
}

// Format a Date back to YYYY-MM-DD in Phoenix TZ for assertions.
function toAzYmd(d: Date): string {
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

// Inclusive end date label. Period.end is exclusive — subtract 1ms to get the
// inclusive last day for human-readable comparison against the PDF.
function inclusiveEnd(end: Date): string {
  return toAzYmd(new Date(end.getTime() - 1));
}

// ── Gilbert biweekly fixtures ──────────────────────────────────────────────
//
// All 26 rows from Gilbert W2 PDF (RD29163) + Gilbert 1099 PDF (RD29369) —
// both share identical period boundaries. Format: [periodStart, periodEnd]
// where periodEnd is inclusive.
const GILBERT_PDF_PERIODS: [string, string][] = [
  ['2026-04-20', '2026-05-03'],
  ['2026-05-04', '2026-05-17'],
  ['2026-05-18', '2026-05-31'],
  ['2026-06-01', '2026-06-14'],
  ['2026-06-15', '2026-06-28'],
  ['2026-06-29', '2026-07-12'],
  ['2026-07-13', '2026-07-26'],
  ['2026-07-27', '2026-08-09'],
  ['2026-08-10', '2026-08-23'],
  ['2026-08-24', '2026-09-06'],
  ['2026-09-07', '2026-09-20'],
  ['2026-09-21', '2026-10-04'],
  ['2026-10-05', '2026-10-18'],
  ['2026-10-19', '2026-11-01'],
  ['2026-11-02', '2026-11-15'],
  ['2026-11-16', '2026-11-29'],
  ['2026-11-30', '2026-12-13'],
  ['2026-12-14', '2026-12-27'],
  ['2026-12-28', '2027-01-10'],
  ['2027-01-11', '2027-01-24'],
  ['2027-01-25', '2027-02-07'],
  ['2027-02-08', '2027-02-21'],
  ['2027-02-22', '2027-03-07'],
  ['2027-03-08', '2027-03-21'],
  ['2027-03-22', '2027-04-04'],
  ['2027-04-05', '2027-04-18'],
];

// ── Mesa / Glendale semi-monthly fixtures ───────────────────────────────────
//
// All 17 rows from Mesa W2 PDF (RD29167). Glendale W2 (RD29168) + both 1099
// schedules (RD29368, RD29631) share identical period boundaries.
const SEMI_MONTHLY_PDF_PERIODS: [string, string][] = [
  ['2026-04-16', '2026-04-30'],
  ['2026-05-01', '2026-05-15'],
  ['2026-05-16', '2026-05-31'],
  ['2026-06-01', '2026-06-15'],
  ['2026-06-16', '2026-06-30'],
  ['2026-07-01', '2026-07-15'],
  ['2026-07-16', '2026-07-31'],
  ['2026-08-01', '2026-08-15'],
  ['2026-08-16', '2026-08-31'],
  ['2026-09-01', '2026-09-15'],
  ['2026-09-16', '2026-09-30'],
  ['2026-10-01', '2026-10-15'],
  ['2026-10-16', '2026-10-31'],
  ['2026-11-01', '2026-11-15'],
  ['2026-11-16', '2026-11-30'],
  ['2026-12-01', '2026-12-15'],
  ['2026-12-16', '2026-12-31'],
];

// ─────────────────────────────────────────────────────────────────────────

describe('Gilbert biweekly — matches Paychex PDF', () => {
  for (const [start, end] of GILBERT_PDF_PERIODS) {
    it(`period ${start} → ${end} (start day)`, () => {
      const p = biweeklyPeriodForDate(GILBERT_SCHEDULE, az(start), TZ);
      expect(toAzYmd(p.start)).toBe(start);
      expect(inclusiveEnd(p.end)).toBe(end);
    });

    it(`period ${start} → ${end} (end day)`, () => {
      const p = biweeklyPeriodForDate(GILBERT_SCHEDULE, az(end), TZ);
      expect(toAzYmd(p.start)).toBe(start);
      expect(inclusiveEnd(p.end)).toBe(end);
    });
  }

  it('first period in PDF lands at index 0', () => {
    const p = biweeklyPeriodForDate(GILBERT_SCHEDULE, az('2026-04-20'), TZ);
    expect(p.index).toBe(0);
  });

  it('previous period (negative index) is contiguous', () => {
    const prev = biweeklyPeriodAtIndex(GILBERT_SCHEDULE, -1, TZ);
    const first = biweeklyPeriodAtIndex(GILBERT_SCHEDULE, 0, TZ);
    expect(prev.end.getTime()).toBe(first.start.getTime());
  });

  it('end is exclusive: period.end is midnight of the day AFTER the inclusive end date', () => {
    const p = biweeklyPeriodForDate(GILBERT_SCHEDULE, az('2026-04-25'), TZ);
    // PDF says 4/20 → 5/3 inclusive; exclusive end should be 5/4 midnight.
    expect(toAzYmd(p.end)).toBe('2026-05-04');
  });

  it('round trips: indexAt(date) → periodAt(index) covers date', () => {
    const d = az('2026-08-15');
    const idx = biweeklyPeriodForDate(GILBERT_SCHEDULE, d, TZ).index;
    const p = biweeklyPeriodAtIndex(GILBERT_SCHEDULE, idx, TZ);
    expect(d.getTime()).toBeGreaterThanOrEqual(p.start.getTime());
    expect(d.getTime()).toBeLessThan(p.end.getTime());
  });
});

describe('Mesa + Glendale semi-monthly — matches Paychex PDF', () => {
  for (const [start, end] of SEMI_MONTHLY_PDF_PERIODS) {
    it(`Mesa: period ${start} → ${end} (start day)`, () => {
      const p = semiMonthlyPeriodForDate(MESA_SCHEDULE, az(start), TZ);
      expect(toAzYmd(p.start)).toBe(start);
      expect(inclusiveEnd(p.end)).toBe(end);
    });

    it(`Mesa: period ${start} → ${end} (end day)`, () => {
      const p = semiMonthlyPeriodForDate(MESA_SCHEDULE, az(end), TZ);
      expect(toAzYmd(p.start)).toBe(start);
      expect(inclusiveEnd(p.end)).toBe(end);
    });

    it(`Glendale: period ${start} → ${end} (mid-period date)`, () => {
      // Pick a date in the middle of the period
      const startDate = az(start);
      const endDate = az(end);
      const mid = new Date((startDate.getTime() + endDate.getTime()) / 2);
      const p = semiMonthlyPeriodForDate(GLENDALE_SCHEDULE, mid, TZ);
      expect(toAzYmd(p.start)).toBe(start);
      expect(inclusiveEnd(p.end)).toBe(end);
    });
  }

  it('day 15 lands in 1st half, day 16 lands in 2nd half', () => {
    const a = semiMonthlyPeriodForDate(MESA_SCHEDULE, az('2026-06-15'), TZ);
    const b = semiMonthlyPeriodForDate(MESA_SCHEDULE, az('2026-06-16'), TZ);
    expect(toAzYmd(a.start)).toBe('2026-06-01');
    expect(toAzYmd(b.start)).toBe('2026-06-16');
    expect(b.index).toBe(a.index + 1);
  });

  it('handles February (28-day month) — 2nd half ends on Feb 28', () => {
    const p = semiMonthlyPeriodForDate(MESA_SCHEDULE, az('2027-02-20'), TZ);
    expect(toAzYmd(p.start)).toBe('2027-02-16');
    expect(inclusiveEnd(p.end)).toBe('2027-02-28');
  });

  it('handles February in a leap year (29 days)', () => {
    // 2028 is a leap year. Last day = Feb 29.
    const p = semiMonthlyPeriodForDate(MESA_SCHEDULE, az('2028-02-25'), TZ);
    expect(toAzYmd(p.start)).toBe('2028-02-16');
    expect(inclusiveEnd(p.end)).toBe('2028-02-29');
  });

  it('December 16-31 → next index lands on January 1-15', () => {
    const dec = semiMonthlyPeriodForDate(MESA_SCHEDULE, az('2026-12-20'), TZ);
    const jan = semiMonthlyPeriodAtIndex(MESA_SCHEDULE, dec.index + 1, TZ);
    expect(toAzYmd(jan.start)).toBe('2027-01-01');
    expect(inclusiveEnd(jan.end)).toBe('2027-01-15');
  });
});

describe('semi-monthly index encoding', () => {
  it('encodes and decodes year/month/half symmetrically', () => {
    for (const [y, m, h] of [
      [2026, 1, 0],
      [2026, 6, 1],
      [2026, 12, 0],
      [2027, 2, 1],
      [2030, 7, 0],
    ] as const) {
      const idx = semiMonthlyEncode(y, m, h);
      const decoded = semiMonthlyDecode(idx);
      expect(decoded.year).toBe(y);
      expect(decoded.month).toBe(m);
      expect(decoded.half).toBe(h);
    }
  });

  it('adjacent half-months differ by exactly 1', () => {
    const a = semiMonthlyEncode(2026, 5, 0); // May 1-15
    const b = semiMonthlyEncode(2026, 5, 1); // May 16-31
    const c = semiMonthlyEncode(2026, 6, 0); // June 1-15
    expect(b - a).toBe(1);
    expect(c - b).toBe(1);
  });

  it('December 16-31 → January 1-15 differs by exactly 1', () => {
    const dec2 = semiMonthlyEncode(2026, 12, 1);
    const jan1 = semiMonthlyEncode(2027, 1, 0);
    expect(jan1 - dec2).toBe(1);
  });
});

describe('cross-cadence: Gilbert vs Mesa periods on the same day differ correctly', () => {
  it('on 2026-05-10: Gilbert in 5/4-5/17, Mesa in 5/1-5/15', () => {
    const d = az('2026-05-10');
    const gilbert = biweeklyPeriodForDate(GILBERT_SCHEDULE, d, TZ);
    const mesa = semiMonthlyPeriodForDate(MESA_SCHEDULE, d, TZ);
    expect(toAzYmd(gilbert.start)).toBe('2026-05-04');
    expect(inclusiveEnd(gilbert.end)).toBe('2026-05-17');
    expect(toAzYmd(mesa.start)).toBe('2026-05-01');
    expect(inclusiveEnd(mesa.end)).toBe('2026-05-15');
  });

  it('on 2026-04-25: Gilbert in 4/20-5/3, Mesa in 4/16-4/30', () => {
    const d = az('2026-04-25');
    const gilbert = biweeklyPeriodForDate(GILBERT_SCHEDULE, d, TZ);
    const mesa = semiMonthlyPeriodForDate(MESA_SCHEDULE, d, TZ);
    expect(toAzYmd(gilbert.start)).toBe('2026-04-20');
    expect(inclusiveEnd(gilbert.end)).toBe('2026-05-03');
    expect(toAzYmd(mesa.start)).toBe('2026-04-16');
    expect(inclusiveEnd(mesa.end)).toBe('2026-04-30');
  });
});
