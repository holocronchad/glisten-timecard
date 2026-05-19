// Decides whether the kiosk should surface a CPR-card reminder on the
// clock-in confirmation screen. Kept in its own file so the threshold logic
// is unit-testable without the React tree (same convention as
// services/cpr.ts on the server and shared/cprStatus.ts).
//
// Product rules (Anas 2026-05-19):
//   - Fires ONLY on a `clock_in` punch — one reminder at the start of the
//     shift, never on every lunch / clock-out punch (nag fatigue dilutes it).
//   - Fires when the CPR card is expired OR expires within 30 days.
//   - A *missing* cert is intentionally NOT alerted here: that's a different
//     state and the PIN-reveal CPR panel already shows an "Add" CTA for it.
//     This alert is specifically the "going to expire" case Anas asked for.
import { PunchType, CprState } from './api';

export type CprClockInAlert = {
  bucket: 'expired' | 'expiring_soon';
  // Whole days until expiry. Negative once the card has lapsed.
  daysUntil: number;
};

export const CPR_ALERT_WINDOW_DAYS = 30;

export function cprClockInAlert(
  cpr: CprState | null | undefined,
  punchType: PunchType,
): CprClockInAlert | null {
  if (punchType !== 'clock_in') return null;
  if (!cpr) return null;
  const d = cpr.days_until_expiry;
  if (d === null || d > CPR_ALERT_WINDOW_DAYS) return null;
  return { bucket: d < 0 ? 'expired' : 'expiring_soon', daysUntil: d };
}
