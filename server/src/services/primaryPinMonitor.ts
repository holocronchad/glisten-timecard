// Primary-PIN monitor — rate-arbitrage safeguard for dual-rate staff.
//
// Added 2026-04-29 for Filza, generalized 2026-05-04, made exempt-able
// 2026-06-01 (Dr. Dawood). A "dual-rate" user has a separate WFH rate
// (pay_rate_cents_remote IS NOT NULL) and therefore a rate-arbitrage
// incentive: they could RDP into an office PC from home and punch with their
// primary (in-office) PIN — that punch passes the geofence check (the office
// PC's browser geolocates inside the fence) and records the in-office rate.
// We cannot detect that perfectly server-side, so we flag every in-office
// primary-PIN punch from a dual-rate user for manager review.
//
// Exemption: flagging 100% of a trusted staffer's punches is alert fatigue,
// not anomaly detection. A user the owner explicitly trusts can be marked
// primary_pin_monitor_exempt so their clean in-office punches stop flooding
// the review queue. The control stays active for any future dual-rate hire
// (default not-exempt). Tradeoff: we lose the RDP-arbitrage signal for the
// exempt user — an owner-accepted call, corroborated against the schedule.
//
// Pure function (no I/O) so the flag decision is unit-tested directly rather
// than only through the kiosk route.

export interface PrimaryPinMonitorUser {
  name: string;
  // null = single rate; non-null = dual-rate (separate WFH rate).
  pay_rate_cents_remote: number | null;
  // true = owner-vouched, skip the monitor for this user.
  primary_pin_monitor_exempt: boolean;
}

export interface PrimaryPinMonitorResult {
  flagged: boolean;
  reason: string | null;
}

export function primaryPinMonitor(
  user: PrimaryPinMonitorUser,
  usedRemotePin: boolean,
): PrimaryPinMonitorResult {
  const isDualRate = user.pay_rate_cents_remote != null;
  // Single-rate users have no arbitrage incentive; the WFH PIN already
  // records the remote rate (no in-office claim to verify); an exempt user
  // is owner-trusted. Any of these → no flag.
  if (!isDualRate || usedRemotePin || user.primary_pin_monitor_exempt) {
    return { flagged: false, reason: null };
  }
  return {
    flagged: true,
    reason: `primary_pin_review: ${user.name.split(' ')[0]} (in-office punch — verify vs WFH).`,
  };
}
