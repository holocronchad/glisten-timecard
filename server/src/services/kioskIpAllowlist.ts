// Per-office kiosk IP allowlist (migration 016).
//
// When a kiosk's GPS-based geofence resolution fails (typically because a
// desktop has no GPS hardware and the browser falls back to WiFi/IP-based
// positioning that drifts past the office radius), we accept the punch if
// the request's client IP sits inside one of the office's registered CIDR
// ranges. Office WiFi is strong physical-presence evidence — an attacker
// cannot fake originating from the office router without owning it.
//
// CIDR matching is delegated to ipaddr.js (battle-tested, MIT, already
// installed transitively via express's `proxy-addr` chain). We accept both
// IPv4 (typical residential ISP NAT'd egress like 174.79.61.56/32) and
// IPv6 (Cox/Comcast hand offices a stable /64 prefix while clients rotate
// the host portion via privacy extensions).

import ipaddr from 'ipaddr.js';

export interface KioskIpLocation {
  id: number;
  active: boolean;
  kiosk_ip_cidrs: string[];
}

/**
 * Normalise an incoming client-IP string so it can be matched against a
 * CIDR list. Returns null if the input is missing or unparseable.
 *
 * Express on a trusted-proxy node will give us either:
 *   - "1.2.3.4"               (plain IPv4)
 *   - "::ffff:1.2.3.4"        (IPv4-mapped IPv6, common from Node servers)
 *   - "2001:579:8064:95:..."  (real IPv6)
 *   - "fe80::abcd%eth0"       (zone-id appended; strip it)
 *
 * IPv4-mapped IPv6 addresses are converted to their IPv4 form so a
 * CIDR like 174.79.61.56/32 matches a request that arrives as
 * ::ffff:174.79.61.56.
 */
export function normalizeClientIp(raw: string | null | undefined): ipaddr.IPv4 | ipaddr.IPv6 | null {
  if (!raw) return null;
  const cleaned = raw.split('%')[0].trim();
  if (!ipaddr.isValid(cleaned)) return null;
  const parsed = ipaddr.parse(cleaned);
  if (parsed.kind() === 'ipv6') {
    const v6 = parsed as ipaddr.IPv6;
    if (v6.isIPv4MappedAddress()) {
      return v6.toIPv4Address();
    }
  }
  return parsed;
}

/**
 * Try to match a client IP against the kiosk allowlist of any active
 * office. Returns the first matching office's id, or null.
 *
 * Order is `id ASC` (the locations array is passed in already ordered by
 * the caller's SQL). CIDR overlap across offices is not expected — each
 * office has its own ISP egress — but if it ever happens, the lowest-id
 * office wins. The punch is flagged either way, so a manager would catch
 * the mis-config on review.
 */
export function matchLocationByIp(
  rawIp: string | null | undefined,
  locations: KioskIpLocation[],
): { id: number } | null {
  const client = normalizeClientIp(rawIp);
  if (!client) return null;

  for (const loc of locations) {
    if (!loc.active) continue;
    if (!loc.kiosk_ip_cidrs || loc.kiosk_ip_cidrs.length === 0) continue;

    for (const cidr of loc.kiosk_ip_cidrs) {
      if (cidrMatches(client, cidr)) {
        return { id: loc.id };
      }
    }
  }
  return null;
}

function cidrMatches(client: ipaddr.IPv4 | ipaddr.IPv6, cidr: string): boolean {
  let parsed: [ipaddr.IPv4, number] | [ipaddr.IPv6, number];
  try {
    parsed = ipaddr.parseCIDR(cidr) as [ipaddr.IPv4, number] | [ipaddr.IPv6, number];
  } catch {
    return false; // malformed CIDR in DB — skip, don't crash a punch on it
  }
  const [network, prefix] = parsed;
  if (network.kind() !== client.kind()) return false;
  // kind() match above narrows the union; match() requires both sides
  // the same concrete type and the type system can't see the narrowing.
  return (client as any).match(network, prefix);
}
