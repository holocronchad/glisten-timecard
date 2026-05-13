import { describe, it, expect } from 'vitest';
import {
  buildSegments,
  totalsByDay,
  totalMinutes,
  splitMinutes,
  type PunchLite,
} from '../hours';

function p(
  id: number,
  type: PunchLite['type'],
  iso: string,
  location_id: number | null = 1,
): PunchLite {
  return { id, type, ts: iso, location_id };
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
      { date: '2026-04-27', worked_minutes: 480, open: false },
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
      { date: '2026-04-27', worked_minutes: 480, open: false },
    ]);
  });
});
