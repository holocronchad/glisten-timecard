import { describe, it, expect } from 'vitest';
import { buildSegments, totalsByDay, totalMinutes, splitMinutes, type PunchLite } from '../hours';

function p(
  id: number,
  user_id: number,
  type: PunchLite['type'],
  iso: string,
  flagged = false,
  extra: Partial<PunchLite> = {},
): PunchLite {
  return { id, user_id, type, ts: iso, flagged, ...extra };
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

describe('lunch_review_deduction (migration 015)', () => {
  it('attaches deduction_minutes onto the segment closed by the reviewed clock_out', () => {
    const segs = buildSegments([
      p(1, 1, 'clock_in', '2026-05-19T15:00:00Z'),
      p(2, 1, 'clock_out', '2026-05-19T23:30:00Z', false, {
        lunch_review_deduction_seconds: 1800,
      }),
    ]);
    expect(segs).toHaveLength(1);
    expect(segs[0].lunch_review_deduction_minutes).toBe(30);
  });

  it('totalMinutes subtracts the deduction from the reviewed shift', () => {
    // 8.5h shift with no lunch → 510 minutes raw. Reject removes 30.
    const segs = buildSegments([
      p(1, 1, 'clock_in', '2026-05-19T15:00:00Z'),
      p(2, 1, 'clock_out', '2026-05-19T23:30:00Z', false, {
        lunch_review_deduction_seconds: 1800,
      }),
    ]);
    expect(totalMinutes(segs)).toBe(510 - 30);
  });

  it('approve (deduction=0) leaves totalMinutes untouched', () => {
    const segs = buildSegments([
      p(1, 1, 'clock_in', '2026-05-19T15:00:00Z'),
      p(2, 1, 'clock_out', '2026-05-19T23:30:00Z', false, {
        lunch_review_deduction_seconds: 0,
      }),
    ]);
    expect(totalMinutes(segs)).toBe(510);
  });

  it('totalsByDay applies the deduction within the correct calendar day', () => {
    const segs = buildSegments([
      p(1, 1, 'clock_in', '2026-05-19T15:00:00Z'),
      p(2, 1, 'clock_out', '2026-05-19T23:30:00Z', false, {
        lunch_review_deduction_seconds: 1800,
      }),
    ]);
    const totals = totalsByDay(segs);
    expect(totals).toHaveLength(1);
    expect(totals[0].worked_minutes).toBe(510 - 30);
  });

  it('only the clock_out segment carries the deduction in a shift with a lunch', () => {
    // clock_in 8a → lunch_start 12p (4h) → lunch_end 12:30p → clock_out 5p (4.5h)
    // Reviewed clock_out has deduction 30. Pre-lunch segment must be untouched.
    const segs = buildSegments([
      p(1, 1, 'clock_in', '2026-05-19T15:00:00Z'),
      p(2, 1, 'lunch_start', '2026-05-19T19:00:00Z'),
      p(3, 1, 'lunch_end', '2026-05-19T19:30:00Z'),
      p(4, 1, 'clock_out', '2026-05-20T00:00:00Z', false, {
        lunch_review_deduction_seconds: 1800,
      }),
    ]);
    const paid = segs.filter((s) => s.paid);
    expect(paid).toHaveLength(2);
    expect(paid[0].lunch_review_deduction_minutes).toBe(0);
    expect(paid[1].lunch_review_deduction_minutes).toBe(30);
    // Paid: 4h pre-lunch + 4.5h post-lunch = 510 min raw, minus 30 = 480.
    expect(totalMinutes(segs)).toBe(480);
  });

  it('splitMinutes subtracts deduction from the segment\'s own bucket', () => {
    // WFH PIN clock_in/out (location_id null). Reject deducts 30 → WFH bucket loses 30.
    const punches: PunchLite[] = [
      { id: 1, user_id: 1, type: 'clock_in', ts: '2026-05-19T15:00:00Z', location_id: null },
      {
        id: 2,
        user_id: 1,
        type: 'clock_out',
        ts: '2026-05-19T23:00:00Z',
        location_id: null,
        lunch_review_deduction_seconds: 1800,
      },
    ];
    const segs = buildSegments(punches);
    const split = splitMinutes(segs);
    expect(split.wfh).toBe(8 * 60 - 30);
    expect(split.office).toBe(0);
  });

  it('clamps to zero when deduction exceeds segment length (defensive)', () => {
    // 20 min shift with an (impossible-in-prod) 1800s deduction. Should clamp,
    // not return -10.
    const segs = buildSegments([
      p(1, 1, 'clock_in', '2026-05-19T15:00:00Z'),
      p(2, 1, 'clock_out', '2026-05-19T15:20:00Z', false, {
        lunch_review_deduction_seconds: 1800,
      }),
    ]);
    expect(totalMinutes(segs)).toBe(0);
    expect(totalsByDay(segs)[0].worked_minutes).toBe(0);
  });

  it('approve/pending segments default deduction to 0 even without the field', () => {
    // PunchLite without lunch_review_deduction_seconds (old/legacy fetch).
    const segs = buildSegments([
      p(1, 1, 'clock_in', '2026-05-19T15:00:00Z'),
      p(2, 1, 'clock_out', '2026-05-19T23:00:00Z'),
    ]);
    expect(segs[0].lunch_review_deduction_minutes).toBe(0);
    expect(totalMinutes(segs)).toBe(8 * 60);
  });
});
