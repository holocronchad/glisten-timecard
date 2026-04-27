import { describe, it, expect } from 'vitest';
import { haversineMeters, matchLocation } from '../geofence';

const GILBERT = { lat: 33.289685, lng: -111.694468 };
const MESA = { lat: 33.427361, lng: -111.787988 };
const GLENDALE = { lat: 33.639038, lng: -112.164856 };

describe('haversineMeters', () => {
  it('returns 0 for the same point', () => {
    expect(haversineMeters(GILBERT, GILBERT)).toBeCloseTo(0, 5);
  });

  it('matches a known intra-Phoenix-metro distance', () => {
    // Gilbert ↔ Glendale is ~50–55km. Loose check; we only care it's in km, not km vs m.
    const d = haversineMeters(GILBERT, GLENDALE);
    expect(d).toBeGreaterThan(45_000);
    expect(d).toBeLessThan(60_000);
  });

  it('is symmetric', () => {
    expect(haversineMeters(GILBERT, MESA)).toBeCloseTo(
      haversineMeters(MESA, GILBERT),
      5,
    );
  });

  it('handles small distances within meters', () => {
    // Two points ~50m apart at Phoenix latitude (1° lat ≈ 111km, 1° lng ≈ ~93km)
    const a = GILBERT;
    const b = { lat: GILBERT.lat + 0.00045, lng: GILBERT.lng };
    const d = haversineMeters(a, b);
    expect(d).toBeGreaterThan(45);
    expect(d).toBeLessThan(60);
  });
});

describe('matchLocation', () => {
  const offices = [
    { id: 1, ...GILBERT, geofence_m: 150, active: true },
    { id: 2, ...MESA, geofence_m: 150, active: true },
    { id: 3, ...GLENDALE, geofence_m: 150, active: true },
  ];

  it('returns the office for an in-radius point', () => {
    const r = matchLocation(GILBERT, offices);
    expect(r?.id).toBe(1);
    expect(r?.distance_m).toBeLessThan(1);
  });

  it('returns null when outside every radius', () => {
    // Sky Harbor airport — between Mesa and Glendale, way outside any 150m circle
    const skyHarbor = { lat: 33.4373, lng: -112.0078 };
    expect(matchLocation(skyHarbor, offices)).toBeNull();
  });

  it('skips inactive offices', () => {
    const onlyInactive = [{ id: 1, ...GILBERT, geofence_m: 150, active: false }];
    expect(matchLocation(GILBERT, onlyInactive)).toBeNull();
  });

  it('returns closest office when multiple radii overlap', () => {
    const a = { lat: 0, lng: 0 };
    const b = { lat: 0.0005, lng: 0 }; // ~55m north
    const point = { lat: 0.00005, lng: 0 }; // ~5m from a, ~50m from b
    const r = matchLocation(point, [
      { id: 1, ...a, geofence_m: 200, active: true },
      { id: 2, ...b, geofence_m: 200, active: true },
    ]);
    expect(r?.id).toBe(1);
  });
});
