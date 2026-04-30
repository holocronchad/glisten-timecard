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

describe('nextAllowedPunches state machine (lunch removed 2026-04-29)', () => {
  it('first punch of the day is clock_in only', () => {
    expect(nextAllowedPunches(null)).toEqual(['clock_in']);
  });

  it('after clock_in: only clock_out (no lunch button)', () => {
    expect(nextAllowedPunches(row('clock_in'))).toEqual(['clock_out']);
  });

  it('after clock_out: only clock_in (next shift)', () => {
    expect(nextAllowedPunches(row('clock_out'))).toEqual(['clock_in']);
  });

  it('legacy lunch_start row → offer clock_out so they can end the day', () => {
    expect(nextAllowedPunches(row('lunch_start'))).toEqual(['clock_out']);
  });

  it('legacy lunch_end row → offer clock_out so they can end the day', () => {
    expect(nextAllowedPunches(row('lunch_end'))).toEqual(['clock_out']);
  });

  it('never returns the same type twice — no double clock_in', () => {
    for (const t of ['clock_in', 'clock_out', 'lunch_start', 'lunch_end'] as const) {
      const allowed = nextAllowedPunches(row(t));
      expect(allowed).not.toContain(t);
    }
  });

  it('never offers lunch_start or lunch_end to a new click', () => {
    for (const t of [null, 'clock_in', 'clock_out', 'lunch_start', 'lunch_end'] as const) {
      const allowed = nextAllowedPunches(t === null ? null : row(t));
      expect(allowed).not.toContain('lunch_start');
      expect(allowed).not.toContain('lunch_end');
    }
  });
});
