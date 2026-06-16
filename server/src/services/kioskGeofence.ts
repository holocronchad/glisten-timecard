// Pure kiosk geofence-resolution ordering for POST /api/kiosk/punch.
//
// Extracted from the route so the decision order is unit-testable (same
// pure-boundary convention as services/cprAlert.ts + services/kioskIpAllowlist.ts).
// The route stays responsible for I/O (loading offices, computing the GPS /
// IP / relaxation signals); this function only decides what those signals mean.
//
// Resolution order, most-precise first:
//   2. GPS inside an office fence            → exact match, NOT flagged.
//   3. Client IP in an office allowlist      → office network is strong
//      physical-presence evidence. Consulted even when NO coords were sent,
//      so a fixed front-desk desktop (no GPS hardware, or location denied)
//      can still punch without a location prompt. Flagged for audit.
//   4. Mid-shift relaxation                  → a non-clock_in whose prior open
//      was at a known office < 12h ago inherits that location. Flagged.
//
// If nothing resolves: 400 when we never received coords (ask the user to
// allow location), else 403 (coords present but genuinely outside any office).
//
// Anti-fraud is preserved: the IP path widens which LOCATIONS are accepted,
// never which identity may punch (PIN + lockout still gate that). A
// coords-stripped punch from OUTSIDE every office IP still dead-ends at the
// 400/403 below — being on the office router is the thing that's trusted.

import type { PunchType } from './punches';

export type GeofenceResolution =
  | { kind: 'office'; officeId: number; flagged: boolean; reason: string | null }
  | { kind: 'reject'; status: 400 | 403; error: string; message: string };

export interface RelaxState {
  /** True when a mid-shift relaxation is permitted (route computes this from `latest`). */
  ok: boolean;
  locationId: number | null;
  priorType: string | null;
  priorTsIso: string | null;
}

export function resolveKioskGeofence(args: {
  punchType: PunchType;
  hasCoords: boolean;
  /** matchLocation() office id when GPS sits inside a fence, else null. */
  gpsOfficeId: number | null;
  /** matchLocationByIp() office id when the client IP is allowlisted, else null. */
  ipMatchOfficeId: number | null;
  clientIp: string | null;
  relax: RelaxState;
}): GeofenceResolution {
  const { punchType, hasCoords, gpsOfficeId, ipMatchOfficeId, clientIp, relax } = args;

  // Path 2: precise GPS inside an office fence — cleanest, unflagged.
  if (gpsOfficeId != null) {
    return { kind: 'office', officeId: gpsOfficeId, flagged: false, reason: null };
  }

  // Path 3: kiosk IP allowlist — works with or without coords.
  //
  // Only flag when GPS was *present but outside* the fence — that's the case
  // worth a manager's attention (device was somewhere unexpected). When no
  // coords arrive at all the punch is from a fixed front-desk desktop that
  // has no GPS hardware; flagging every one of those floods the review queue
  // with noise and trains staff to ignore flags entirely.
  if (ipMatchOfficeId != null) {
    return {
      kind: 'office',
      officeId: ipMatchOfficeId,
      flagged: hasCoords,
      reason: hasCoords
        ? `ip_allowlist: client IP ${clientIp ?? 'unknown'} matched office ${ipMatchOfficeId} ` +
          `kiosk allowlist (GPS at ${punchType} was outside fence).`
        : null,
    };
  }

  // No coords AND not on a trusted office network → we can't place them.
  // Kept ahead of relaxation so the no-coords path behaves exactly as before
  // except when the IP allowlist (above) already rescued it.
  if (!hasCoords) {
    return {
      kind: 'reject',
      status: 400,
      error: 'Location required',
      message: 'Allow location in your browser, then try again.',
    };
  }

  // Path 4: mid-shift relaxation (coords present, GPS drifted, not an office IP).
  if (relax.ok && relax.locationId != null) {
    return {
      kind: 'office',
      officeId: relax.locationId,
      flagged: true,
      reason:
        `GPS reported outside office geofence at ${punchType}; auto-allowed because ` +
        `${relax.priorType} was recorded at this location ${relax.priorTsIso}.`,
    };
  }

  return {
    kind: 'reject',
    status: 403,
    error: 'Outside office',
    message: 'You can only punch when you are at a Glisten Dental office.',
  };
}
