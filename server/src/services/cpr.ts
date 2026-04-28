// CPR cert helpers — kept in their own file so the math is unit-testable
// without spinning up the full Express app.

export type CprStatus = 'missing' | 'expired' | 'expiring_soon' | 'expiring' | 'current';

/**
 * Returns whole days remaining until cert expiry. Negative if expired.
 * `null` if the cert hasn't been recorded yet.
 *
 * Day rounding is floor(deltaMs / 24h) so a cert expiring in 23h still
 * reads "0 days" — that's the correct UX for a kiosk: anything under 24h is
 * "today is the last day."
 */
export function cprDaysUntil(
  expiresAt: Date | string | null,
  now: Date = new Date(),
): number | null {
  if (!expiresAt) return null;
  const expiry = expiresAt instanceof Date ? expiresAt : new Date(expiresAt);
  if (Number.isNaN(expiry.getTime())) return null;
  const ms = expiry.getTime() - now.getTime();
  return Math.floor(ms / (24 * 60 * 60_000));
}

/** UI-friendly bucket. */
export function cprStatus(daysUntil: number | null): CprStatus {
  if (daysUntil === null) return 'missing';
  if (daysUntil < 0) return 'expired';
  if (daysUntil <= 30) return 'expiring_soon';
  if (daysUntil <= 60) return 'expiring';
  return 'current';
}
