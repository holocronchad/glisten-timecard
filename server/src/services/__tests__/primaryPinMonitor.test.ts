import { describe, it, expect } from 'vitest';
import { primaryPinMonitor } from '../primaryPinMonitor';

// Filza: the real dual-rate user this monitor was built for ($21/hr WFH rate).
const dualRate = {
  name: 'Filza Tirmizi',
  pay_rate_cents_remote: 2100,
  primary_pin_monitor_exempt: false,
};

describe('primaryPinMonitor', () => {
  it('flags a non-exempt dual-rate user punching in-office with their primary PIN', () => {
    const r = primaryPinMonitor(dualRate, false);
    expect(r.flagged).toBe(true);
    expect(r.reason).toBe(
      'primary_pin_review: Filza (in-office punch — verify vs WFH).',
    );
  });

  it('does NOT flag when the WFH (remote) PIN was used — remote rate already recorded', () => {
    expect(primaryPinMonitor(dualRate, true)).toEqual({ flagged: false, reason: null });
  });

  it('does NOT flag a single-rate user (no arbitrage incentive)', () => {
    const single = { ...dualRate, pay_rate_cents_remote: null };
    expect(primaryPinMonitor(single, false)).toEqual({ flagged: false, reason: null });
  });

  it('does NOT flag a dual-rate user who is monitor-exempt (Dr. Dawood trust) — the fix', () => {
    const exempt = { ...dualRate, primary_pin_monitor_exempt: true };
    expect(primaryPinMonitor(exempt, false)).toEqual({ flagged: false, reason: null });
  });

  it('exemption + remote PIN still does not flag', () => {
    const exempt = { ...dualRate, primary_pin_monitor_exempt: true };
    expect(primaryPinMonitor(exempt, true).flagged).toBe(false);
  });

  it('uses first name only, even for multi-part names', () => {
    const r = primaryPinMonitor({ ...dualRate, name: 'Mary Jane Watson' }, false);
    expect(r.reason).toContain('primary_pin_review: Mary ');
  });
});
