import { describe, it, expect } from 'vitest';
import {
  buildSegments,
  totalsByDay,
  totalMinutes,
  splitMinutes,
  totalDeductionMinutes,
  decimalHours,
  type PunchLite,
} from '../hours';

function p(
  id: number,
  type: PunchLite['type'],
  iso: string,
  location_id: number | null = 1,
  extra: Partial<PunchLite> = {},
): PunchLite {
  return { id, type, ts: iso, location_id, ...extra };
}

describe('web shared/hours', () => {
  it('pairs clock_in / clock_out into one paid segment', () => {
    const segs = buildSegments([
      p(1, 'clock_in', '2026-04-27T15:00:00Z'),
      p(2, 'clock_out', '2026-04-27T23:00:00Z'),
    ]);
    expect(segs).toHaveLength(1);
    expect(segs[0]).toMatchObject({ paid: true, open: false });
  });

  it('totalMinutes sums paid segments only and excludes lunch', () => {
    const segs = buildSegments([
      p(1, 'clock_in', '2026-04-27T15:00:00Z'),
      p(2, 'lunch_start', '2026-04-27T19:00:00Z'),
      p(3, 'lunch_end', '2026-04-27T19:30:00Z'),
      p(4, 'clock_out', '2026-04-27T23:00:00Z'),
    ]);
    // 4h before + 3.5h after = 7.5h = 450
    expect(totalMinutes(segs)).toBe(450);
  });

  it('treats unpaired clock_in as open up to "now"', () => {
    const now = new Date('2026-04-27T20:00:00Z');
    const segs = buildSegments([p(1, 'clock_in', '2026-04-27T15:00:00Z')], now);
    expect(segs).toHaveLength(1);
    expect(segs[0].open).toBe(true);
    expect(segs[0].end.getTime()).toBe(now.getTime());
  });

  it('totalsByDay buckets to AZ calendar date', () => {
    // 8 AM AZ on 2026-04-27 → 15:00 UTC
    const segs = buildSegments([
      p(1, 'clock_in', '2026-04-27T15:00:00Z'),
      p(2, 'clock_out', '2026-04-27T23:00:00Z'),
    ]);
    const totals = totalsByDay(segs);
    expect(totals).toEqual([
      { date: '2026-04-27', worked_minutes: 480, open: false, deduction_minutes: 0 },
    ]);
  });

  it('splitMinutes buckets office vs WFH by opening-punch location_id', () => {
    const segs = buildSegments([
      // Office shift Mon: 6h
      p(1, 'clock_in', '2026-04-27T15:00:00Z', 1),
      p(2, 'clock_out', '2026-04-27T21:00:00Z', 1),
      // WFH shift Tue: 4h (clock_in carries the null)
      p(3, 'clock_in', '2026-04-28T15:00:00Z', null),
      p(4, 'clock_out', '2026-04-28T19:00:00Z', null),
    ]);
    expect(splitMinutes(segs)).toEqual({ office: 360, wfh: 240 });
  });

  it('handles a shift that spans into the next AZ calendar day', () => {
    // 10 PM AZ → 6 AM AZ next day
    const segs = buildSegments([
      p(1, 'clock_in', '2026-04-28T05:00:00Z'), // 10 PM AZ
      p(2, 'clock_out', '2026-04-28T13:00:00Z'), // 6 AM AZ
    ]);
    const totals = totalsByDay(segs);
    // The whole 8h block is bucketed by `start`, which is 2026-04-27 in AZ
    expect(totals).toEqual([
      { date: '2026-04-27', worked_minutes: 480, open: false, deduction_minutes: 0 },
    ]);
  });
});

describe('lunch_review_deduction (migration 015)', () => {
  it('attaches deduction onto the segment closed by the reviewed clock_out', () => {
    const segs = buildSegments([
      p(1, 'clock_in', '2026-05-19T15:00:00Z'),
      p(2, 'clock_out', '2026-05-19T23:30:00Z', 1, {
        lunch_review_deduction_seconds: 1800,
      }),
    ]);
    expect(segs[0].lunch_review_deduction_minutes).toBe(30);
    expect(totalMinutes(segs)).toBe(510 - 30);
    expect(totalsByDay(segs)[0].worked_minutes).toBe(480);
    expect(totalDeductionMinutes(segs)).toBe(30);
  });

  it('approve (deduction=0) leaves the shift untouched', () => {
    const segs = buildSegments([
      p(1, 'clock_in', '2026-05-19T15:00:00Z'),
      p(2, 'clock_out', '2026-05-19T23:30:00Z', 1, {
        lunch_review_deduction_seconds: 0,
      }),
    ]);
    expect(totalMinutes(segs)).toBe(510);
    expect(totalDeductionMinutes(segs)).toBe(0);
  });

  it('splitMinutes pulls the deduction from the reviewed segment\'s own bucket', () => {
    const segs = buildSegments([
      p(1, 'clock_in', '2026-05-19T15:00:00Z', null), // WFH
      p(2, 'clock_out', '2026-05-19T23:00:00Z', null, {
        lunch_review_deduction_seconds: 1800,
      }),
    ]);
    expect(splitMinutes(segs)).toEqual({ office: 0, wfh: 8 * 60 - 30 });
  });

  it('clamps to zero when deduction exceeds raw segment minutes', () => {
    const segs = buildSegments([
      p(1, 'clock_in', '2026-05-19T15:00:00Z'),
      p(2, 'clock_out', '2026-05-19T15:20:00Z', 1, {
        lunch_review_deduction_seconds: 1800,
      }),
    ]);
    expect(totalMinutes(segs)).toBe(0);
  });
});

describe('decimalHours (payroll display)', () => {
  // Must stay byte-identical to the payroll CSV's `(minutes / 60).toFixed(2)`
  // (server/src/services/payroll.ts rowsToCsv) — Dr. Dawood reconciles the
  // on-screen number against the exported CSV, so the formats cannot diverge.
  it('formats whole + fractional hours to two decimals', () => {
    expect(decimalHours(495)).toBe('8.25'); // 8h 15m
    expect(decimalHours(500)).toBe('8.33'); // 8h 20m (repeating, truncated by toFixed)
    expect(decimalHours(2400)).toBe('40.00'); // exactly 40h
    expect(decimalHours(0)).toBe('0.00');
  });

  it('matches the CSV convention exactly', () => {
    for (const m of [0, 1, 7, 90, 495, 2403, 4811]) {
      expect(decimalHours(m)).toBe((m / 60).toFixed(2));
    }
  });
});
