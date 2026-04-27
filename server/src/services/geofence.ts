// Haversine distance + geofence membership check.
// Pure functions, no I/O.

const EARTH_RADIUS_M = 6371000;

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

/**
 * Distance in meters between two lat/lng pairs.
 */
export function haversineMeters(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number }
): number {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.sin(dLng / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(h));
}

/**
 * Given a user's lat/lng and a list of locations, return the matching location
 * (within its geofence) or null. Returns the CLOSEST matching location if more
 * than one office could include the point.
 */
export function matchLocation(
  point: { lat: number; lng: number },
  locations: { id: number; lat: number; lng: number; geofence_m: number; active: boolean }[]
): { id: number; distance_m: number } | null {
  let best: { id: number; distance_m: number } | null = null;
  for (const loc of locations) {
    if (!loc.active) continue;
    const d = haversineMeters(point, loc);
    if (d <= loc.geofence_m && (best === null || d < best.distance_m)) {
      best = { id: loc.id, distance_m: d };
    }
  }
  return best;
}
