import { describe, it, expect } from 'vitest';
import { nextAllowedPunches } from '../punches';

function row(type: 'clock_in' | 'clock_out' | 'lunch_start' | 'lunch_end') {
  return {
    id: 1,
    user_id: 1,
    location_id: 1,
    type,
    ts: new Date(),
    source: 'kiosk' as const,
    geofence_pass: true,
    flagged: false,
    flag_reason: null,
    auto_closed_at: null,
  };
}

describe('nextAllowedPunches state machine', () => {
  it('first punch of the day is clock_in only', () => {
    expect(nextAllowedPunches(null)).toEqual(['clock_in']);
  });

  it('after clock_in: can clock_out or start lunch', () => {
    expect(nextAllowedPunches(row('clock_in'))).toEqual([
      'clock_out',
      'lunch_start',
    ]);
  });

  it('after lunch_start: can only end lunch', () => {
    expect(nextAllowedPunches(row('lunch_start'))).toEqual(['lunch_end']);
  });

  it('after lunch_end: same as after clock_in (back on the clock)', () => {
    expect(nextAllowedPunches(row('lunch_end'))).toEqual([
      'clock_out',
      'lunch_start',
    ]);
  });

  it('after clock_out: only clock_in (next day or next shift)', () => {
    expect(nextAllowedPunches(row('clock_out'))).toEqual(['clock_in']);
  });

  it('never returns the same type twice — no double clock_in', () => {
    for (const t of ['clock_in', 'clock_out', 'lunch_start', 'lunch_end'] as const) {
      const allowed = nextAllowedPunches(row(t));
      expect(allowed).not.toContain(t);
    }
  });
});
