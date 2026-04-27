import { describe, it, expect } from 'vitest';
import { periodForDate, periodByIndex } from '../payPeriod';

const ANCHOR = '2026-01-05'; // a Monday
const TZ = 'America/Phoenix';

describe('periodForDate', () => {
  it('returns index 0 for the anchor date', () => {
    const p = periodForDate(new Date('2026-01-05T12:00:00-07:00'), ANCHOR, 14, TZ);
    expect(p.index).toBe(0);
  });

  it('returns index 0 within the first 14-day window', () => {
    const p = periodForDate(new Date('2026-01-12T12:00:00-07:00'), ANCHOR, 14, TZ);
    expect(p.index).toBe(0);
  });

  it('returns index 1 immediately after the first window closes', () => {
    const p = periodForDate(new Date('2026-01-19T12:00:00-07:00'), ANCHOR, 14, TZ);
    expect(p.index).toBe(1);
  });

  it('returns the same index for any time during a single period', () => {
    const a = periodForDate(new Date('2026-01-19T00:30:00-07:00'), ANCHOR, 14, TZ);
    const b = periodForDate(new Date('2026-01-25T23:30:00-07:00'), ANCHOR, 14, TZ);
    expect(a.index).toBe(b.index);
  });

  it('handles dates before the anchor (negative index)', () => {
    const p = periodForDate(new Date('2025-12-22T12:00:00-07:00'), ANCHOR, 14, TZ);
    expect(p.index).toBeLessThan(0);
  });
});

describe('periodByIndex', () => {
  it('round-trips: periodByIndex(periodForDate(d).index) covers d', () => {
    const d = new Date('2026-04-27T18:00:00-07:00');
    const idx = periodForDate(d, ANCHOR, 14, TZ).index;
    const p = periodByIndex(idx, ANCHOR, 14, TZ);
    expect(d.getTime()).toBeGreaterThanOrEqual(p.start.getTime());
    expect(d.getTime()).toBeLessThan(p.end.getTime());
  });

  it('end is exactly start + 14 days', () => {
    const p = periodByIndex(7, ANCHOR, 14, TZ);
    expect(p.end.getTime() - p.start.getTime()).toBe(14 * 24 * 60 * 60_000);
  });

  it('consecutive periods are exactly contiguous', () => {
    const a = periodByIndex(3, ANCHOR, 14, TZ);
    const b = periodByIndex(4, ANCHOR, 14, TZ);
    expect(b.start.getTime()).toBe(a.end.getTime());
  });

  it('label is always "yyyy-mm-dd → yyyy-mm-dd"', () => {
    const p = periodByIndex(0, ANCHOR, 14, TZ);
    expect(p.label).toMatch(/^\d{4}-\d{2}-\d{2} → \d{4}-\d{2}-\d{2}$/);
  });
});
