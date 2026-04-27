import { describe, it, expect } from 'vitest';
import { buildSegments, totalsByDay, totalMinutes, type PunchLite } from '../hours';

function p(
  id: number,
  user_id: number,
  type: PunchLite['type'],
  iso: string,
  flagged = false,
): PunchLite {
  return { id, user_id, type, ts: iso, flagged };
}

describe('buildSegments', () => {
  it('pairs a simple clock_in / clock_out into one paid segment', () => {
    const punches = [
      p(1, 1, 'clock_in', '2026-04-27T15:00:00Z'),
      p(2, 1, 'clock_out', '2026-04-27T23:00:00Z'),
    ];
    const segs = buildSegments(punches);
    expect(segs).toHaveLength(1);
    expect(segs[0]).toMatchObject({ paid: true, open: false });
    expect(segs[0].end.getTime() - segs[0].start.getTime()).toBe(8 * 60 * 60_000);
  });

  it('builds three segments for a day with one lunch', () => {
    const punches = [
      p(1, 1, 'clock_in', '2026-04-27T15:00:00Z'),
      p(2, 1, 'lunch_start', '2026-04-27T19:00:00Z'),
      p(3, 1, 'lunch_end', '2026-04-27T19:30:00Z'),
      p(4, 1, 'clock_out', '2026-04-27T23:00:00Z'),
    ];
    const segs = buildSegments(punches);
    expect(segs).toHaveLength(3);
    expect(segs.filter((s) => s.paid)).toHaveLength(2);
    expect(segs.find((s) => !s.paid)?.end.getTime()).toBe(
      new Date('2026-04-27T19:30:00Z').getTime(),
    );
  });

  it('treats unpaired clock_in as an open segment ending at "now"', () => {
    const now = new Date('2026-04-27T20:00:00Z');
    const segs = buildSegments(
      [p(1, 1, 'clock_in', '2026-04-27T15:00:00Z')],
      now,
    );
    expect(segs).toHaveLength(1);
    expect(segs[0].open).toBe(true);
    expect(segs[0].end.getTime()).toBe(now.getTime());
  });

  it('handles consecutive clock_ins by closing the prior shift defensively', () => {
    const segs = buildSegments([
      p(1, 1, 'clock_in', '2026-04-27T15:00:00Z'),
      p(2, 1, 'clock_in', '2026-04-27T20:00:00Z'),
    ]);
    expect(segs).toHaveLength(2);
    expect(segs[0].flagged).toBe(true);
  });

  it('lunch_end without a lunch_start does not produce a fake unpaid segment', () => {
    const segs = buildSegments([
      p(1, 1, 'clock_in', '2026-04-27T15:00:00Z'),
      p(2, 1, 'lunch_end', '2026-04-27T19:00:00Z'),
      p(3, 1, 'clock_out', '2026-04-27T23:00:00Z'),
    ]);
    expect(segs.filter((s) => !s.paid)).toHaveLength(0);
  });

  it('totalMinutes sums paid segments only', () => {
    const segs = buildSegments([
      p(1, 1, 'clock_in', '2026-04-27T15:00:00Z'),
      p(2, 1, 'lunch_start', '2026-04-27T19:00:00Z'),
      p(3, 1, 'lunch_end', '2026-04-27T19:30:00Z'),
      p(4, 1, 'clock_out', '2026-04-27T23:00:00Z'),
    ]);
    // Paid: 4h before lunch + 3.5h after = 7.5h = 450 minutes
    expect(totalMinutes(segs)).toBe(450);
  });
});

describe('totalsByDay (America/Phoenix)', () => {
  it('buckets a single 8h shift into one calendar day', () => {
    const segs = buildSegments([
      p(1, 1, 'clock_in', '2026-04-27T15:00:00Z'), // 8 AM AZ
      p(2, 1, 'clock_out', '2026-04-27T23:00:00Z'), // 4 PM AZ
    ]);
    const totals = totalsByDay(segs);
    expect(totals).toHaveLength(1);
    expect(totals[0]).toEqual({
      date: '2026-04-27',
      worked_minutes: 480,
      open: false,
    });
  });

  it('does not include unpaid lunch in worked_minutes', () => {
    const segs = buildSegments([
      p(1, 1, 'clock_in', '2026-04-27T15:00:00Z'),
      p(2, 1, 'lunch_start', '2026-04-27T19:00:00Z'),
      p(3, 1, 'lunch_end', '2026-04-27T20:00:00Z'),
      p(4, 1, 'clock_out', '2026-04-28T00:00:00Z'),
    ]);
    const totals = totalsByDay(segs);
    expect(totals[0].worked_minutes).toBe(8 * 60); // 4h + 4h, lunch hour excluded
  });
});
