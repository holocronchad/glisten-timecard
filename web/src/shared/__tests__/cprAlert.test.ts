import { describe, it, expect } from 'vitest';
import { cprClockInAlert } from '../cprAlert';
import type { CprState } from '../api';

const cpr = (daysUntil: number | null): CprState => ({
  org: 'American Heart Association',
  issued_at: '2024-01-01',
  expires_at: '2026-06-01',
  updated_at: '2025-01-01',
  days_until_expiry: daysUntil,
});

describe('cprClockInAlert', () => {
  it('fires on clock_in when the card expires within 30 days', () => {
    expect(cprClockInAlert(cpr(30), 'clock_in')).toEqual({
      bucket: 'expiring_soon',
      daysUntil: 30,
    });
    expect(cprClockInAlert(cpr(1), 'clock_in')).toEqual({
      bucket: 'expiring_soon',
      daysUntil: 1,
    });
  });

  it('treats "expires today" (0 days) as expiring_soon, not expired', () => {
    expect(cprClockInAlert(cpr(0), 'clock_in')).toEqual({
      bucket: 'expiring_soon',
      daysUntil: 0,
    });
  });

  it('flags an already-expired card as the urgent (expired) bucket', () => {
    expect(cprClockInAlert(cpr(-4), 'clock_in')).toEqual({
      bucket: 'expired',
      daysUntil: -4,
    });
  });

  it('is silent at the 31-day boundary (just outside the window)', () => {
    expect(cprClockInAlert(cpr(31), 'clock_in')).toBeNull();
    expect(cprClockInAlert(cpr(365), 'clock_in')).toBeNull();
  });

  it('is silent when no cert is on file (missing != expiring)', () => {
    expect(cprClockInAlert(cpr(null), 'clock_in')).toBeNull();
    expect(cprClockInAlert(null, 'clock_in')).toBeNull();
    expect(cprClockInAlert(undefined, 'clock_in')).toBeNull();
  });

  it('only fires on clock_in — never lunch / clock-out punches', () => {
    expect(cprClockInAlert(cpr(5), 'clock_out')).toBeNull();
    expect(cprClockInAlert(cpr(5), 'lunch_start')).toBeNull();
    expect(cprClockInAlert(cpr(5), 'lunch_end')).toBeNull();
    expect(cprClockInAlert(cpr(-2), 'clock_out')).toBeNull();
  });
});
