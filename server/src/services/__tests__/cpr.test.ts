import { describe, it, expect } from 'vitest';
import { cprDaysUntil, cprStatus } from '../cpr';

describe('cprDaysUntil', () => {
  it('returns null when no cert recorded', () => {
    expect(cprDaysUntil(null)).toBeNull();
    expect(cprDaysUntil('not-a-date')).toBeNull();
  });

  it('returns positive days for a future expiry', () => {
    const now = new Date('2026-04-28T12:00:00Z');
    const future = new Date('2026-08-12T12:00:00Z');
    expect(cprDaysUntil(future, now)).toBe(106);
  });

  it('returns 0 on the day of expiry (within 24h)', () => {
    const now = new Date('2026-04-28T12:00:00Z');
    const sameDay = new Date('2026-04-29T11:00:00Z');
    expect(cprDaysUntil(sameDay, now)).toBe(0);
  });

  it('returns negative days for an expired cert', () => {
    const now = new Date('2026-04-28T12:00:00Z');
    const past = new Date('2026-04-25T12:00:00Z');
    expect(cprDaysUntil(past, now)).toBe(-3);
  });

  it('accepts a Date instance', () => {
    const now = new Date('2026-04-28T12:00:00Z');
    const future = new Date('2026-04-30T12:00:00Z');
    expect(cprDaysUntil(future, now)).toBe(2);
  });
});

describe('cprStatus', () => {
  it('classifies missing cert', () => {
    expect(cprStatus(null)).toBe('missing');
  });

  it('classifies expired cert', () => {
    expect(cprStatus(-1)).toBe('expired');
    expect(cprStatus(-100)).toBe('expired');
  });

  it('classifies expiring_soon (≤ 30 days)', () => {
    expect(cprStatus(0)).toBe('expiring_soon');
    expect(cprStatus(30)).toBe('expiring_soon');
  });

  it('classifies expiring (31–60 days)', () => {
    expect(cprStatus(31)).toBe('expiring');
    expect(cprStatus(60)).toBe('expiring');
  });

  it('classifies current (> 60 days)', () => {
    expect(cprStatus(61)).toBe('current');
    expect(cprStatus(365)).toBe('current');
  });
});
