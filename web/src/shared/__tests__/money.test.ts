import { describe, it, expect } from 'vitest';
import { centsToDollars, parseDollarsToCents } from '../money';

describe('centsToDollars', () => {
  it('formats cents to a 2-decimal dollar string (matches BlurredRate)', () => {
    expect(centsToDollars(2450)).toBe('24.50');
    expect(centsToDollars(2400)).toBe('24.00');
    expect(centsToDollars(100000)).toBe('1000.00');
    expect(centsToDollars(0)).toBe('0.00');
  });
  it('returns empty string for null/undefined (salary / no WFH rate)', () => {
    expect(centsToDollars(null)).toBe('');
    expect(centsToDollars(undefined)).toBe('');
  });
});

describe('parseDollarsToCents', () => {
  it('parses valid dollar inputs to integer cents', () => {
    expect(parseDollarsToCents('24')).toEqual({ ok: true, cents: 2400 });
    expect(parseDollarsToCents('24.5')).toEqual({ ok: true, cents: 2450 });
    expect(parseDollarsToCents('24.50')).toEqual({ ok: true, cents: 2450 });
    expect(parseDollarsToCents('  $1,250.00 ')).toEqual({ ok: true, cents: 125000 });
    expect(parseDollarsToCents('0')).toEqual({ ok: true, cents: 0 });
  });
  it('rounds to the nearest cent', () => {
    expect(parseDollarsToCents('24.555')).toMatchObject({ ok: false }); // >2 decimals rejected
    expect(parseDollarsToCents('33.33')).toEqual({ ok: true, cents: 3333 });
  });
  it('rejects empty, negative, junk, and absurd magnitudes', () => {
    for (const bad of ['', '   ', '-5', '-0.01', 'abc', '12.', '.5', '24.5.0', '1e3', '999999']) {
      expect(parseDollarsToCents(bad).ok).toBe(false);
    }
  });
  it('accepts the documented ceiling and rejects just past it', () => {
    expect(parseDollarsToCents('99999.99')).toEqual({ ok: true, cents: 9999999 });
    expect(parseDollarsToCents('100000').ok).toBe(false);
  });
});
