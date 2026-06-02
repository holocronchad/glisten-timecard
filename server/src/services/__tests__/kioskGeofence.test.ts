import { describe, it, expect } from 'vitest';
import { resolveKioskGeofence, type RelaxState } from '../kioskGeofence';

const noRelax: RelaxState = { ok: false, locationId: null, priorType: null, priorTsIso: null };

describe('resolveKioskGeofence', () => {
  it('Path 2: GPS inside a fence wins, unflagged', () => {
    const r = resolveKioskGeofence({
      punchType: 'clock_in',
      hasCoords: true,
      gpsOfficeId: 2,
      ipMatchOfficeId: 2,
      clientIp: '174.79.61.56',
      relax: noRelax,
    });
    expect(r).toEqual({ kind: 'office', officeId: 2, flagged: false, reason: null });
  });

  it('Path 3: GPS outside but office IP matches → accepted, flagged (coords present)', () => {
    const r = resolveKioskGeofence({
      punchType: 'clock_in',
      hasCoords: true,
      gpsOfficeId: null,
      ipMatchOfficeId: 2,
      clientIp: '174.79.61.56',
      relax: noRelax,
    });
    expect(r.kind).toBe('office');
    if (r.kind === 'office') {
      expect(r.officeId).toBe(2);
      expect(r.flagged).toBe(true);
      expect(r.reason).toContain('ip_allowlist');
      expect(r.reason).toContain('GPS at clock_in was outside fence');
    }
  });

  it('NEW — desktop fix: NO coords + office IP match → accepted (not 400), flagged', () => {
    const r = resolveKioskGeofence({
      punchType: 'clock_in',
      hasCoords: false,
      gpsOfficeId: null,
      ipMatchOfficeId: 2,
      clientIp: '2001:48:60:7:f0e::fc',
      relax: noRelax,
    });
    expect(r.kind).toBe('office');
    if (r.kind === 'office') {
      expect(r.officeId).toBe(2);
      expect(r.flagged).toBe(true);
      expect(r.reason).toContain('no GPS coords provided');
    }
  });

  it('NO coords + NO office IP → 400 Location required', () => {
    const r = resolveKioskGeofence({
      punchType: 'clock_in',
      hasCoords: false,
      gpsOfficeId: null,
      ipMatchOfficeId: null,
      clientIp: '8.8.8.8',
      relax: noRelax,
    });
    expect(r).toEqual({
      kind: 'reject',
      status: 400,
      error: 'Location required',
      message: 'Allow location in your browser, then try again.',
    });
  });

  it('Path 4: coords present, GPS drifted, not office IP, mid-shift relax → inherits, flagged', () => {
    const r = resolveKioskGeofence({
      punchType: 'clock_out',
      hasCoords: true,
      gpsOfficeId: null,
      ipMatchOfficeId: null,
      clientIp: '50.1.2.3',
      relax: { ok: true, locationId: 2, priorType: 'clock_in', priorTsIso: '2026-06-02T14:00:00.000Z' },
    });
    expect(r.kind).toBe('office');
    if (r.kind === 'office') {
      expect(r.officeId).toBe(2);
      expect(r.flagged).toBe(true);
      expect(r.reason).toContain('auto-allowed because clock_in');
    }
  });

  it('coords present, no GPS, no IP, no relax (clock_in) → 403 Outside office', () => {
    const r = resolveKioskGeofence({
      punchType: 'clock_in',
      hasCoords: true,
      gpsOfficeId: null,
      ipMatchOfficeId: null,
      clientIp: '50.1.2.3',
      relax: noRelax,
    });
    expect(r).toEqual({
      kind: 'reject',
      status: 403,
      error: 'Outside office',
      message: 'You can only punch when you are at a Glisten Dental office.',
    });
  });

  it('preserves original: NO coords still 400 even when a mid-shift relax would otherwise apply (relax never reached without coords)', () => {
    const r = resolveKioskGeofence({
      punchType: 'clock_out',
      hasCoords: false,
      gpsOfficeId: null,
      ipMatchOfficeId: null,
      clientIp: null,
      relax: { ok: true, locationId: 2, priorType: 'clock_in', priorTsIso: '2026-06-02T14:00:00.000Z' },
    });
    expect(r.kind).toBe('reject');
    if (r.kind === 'reject') expect(r.status).toBe(400);
  });
});
