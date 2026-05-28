import { describe, it, expect } from 'vitest';
import { matchLocationByIp, normalizeClientIp } from '../kioskIpAllowlist';

const offices = [
  { id: 1, active: true,  kiosk_ip_cidrs: ['98.172.87.245/32'] },                  // Gilbert IPv4 host
  { id: 2, active: true,  kiosk_ip_cidrs: ['174.79.61.56/32'] },                   // Mesa IPv4 host
  { id: 3, active: true,  kiosk_ip_cidrs: ['2001:579:8064:95::/64'] },             // Glendale IPv6 /64
];

describe('normalizeClientIp', () => {
  it('parses plain IPv4', () => {
    expect(normalizeClientIp('174.79.61.56')?.toString()).toBe('174.79.61.56');
  });

  it('unwraps IPv4-mapped IPv6 to IPv4', () => {
    expect(normalizeClientIp('::ffff:174.79.61.56')?.toString()).toBe('174.79.61.56');
  });

  it('strips zone identifier from IPv6', () => {
    const r = normalizeClientIp('fe80::1%eth0');
    expect(r).not.toBeNull();
    expect(r!.kind()).toBe('ipv6');
  });

  it('returns null for missing or garbage input', () => {
    expect(normalizeClientIp(null)).toBeNull();
    expect(normalizeClientIp(undefined)).toBeNull();
    expect(normalizeClientIp('')).toBeNull();
    expect(normalizeClientIp('not-an-ip')).toBeNull();
  });
});

describe('matchLocationByIp', () => {
  it('matches the exact IPv4 host CIDR (Mesa Mesha case)', () => {
    expect(matchLocationByIp('174.79.61.56', offices)?.id).toBe(2);
  });

  it('matches an IPv4-mapped IPv6 form against the IPv4 CIDR', () => {
    // Node servers commonly surface IPv4 clients as ::ffff:1.2.3.4
    expect(matchLocationByIp('::ffff:174.79.61.56', offices)?.id).toBe(2);
  });

  it('matches an IPv6 host inside a /64 office prefix (Glendale)', () => {
    // Privacy-extension addresses rotate within Glendale's /64
    expect(matchLocationByIp('2001:579:8064:95:abcd:ef01:2345:6789', offices)?.id).toBe(3);
    expect(matchLocationByIp('2001:579:8064:95:1086:d8e2:5fd5:20ec', offices)?.id).toBe(3);
  });

  it('returns null when the IP matches no office', () => {
    expect(matchLocationByIp('8.8.8.8', offices)).toBeNull();
    expect(matchLocationByIp('2606:4700:4700::1111', offices)).toBeNull(); // Cloudflare DNS
  });

  it('skips inactive offices even if their CIDR matches', () => {
    const inactive = [{ id: 2, active: false, kiosk_ip_cidrs: ['174.79.61.56/32'] }];
    expect(matchLocationByIp('174.79.61.56', inactive)).toBeNull();
  });

  it('skips offices with empty allowlist (default state)', () => {
    const empty = [{ id: 1, active: true, kiosk_ip_cidrs: [] }];
    expect(matchLocationByIp('174.79.61.56', empty)).toBeNull();
  });

  it('returns null on missing IP — never silently grants access', () => {
    expect(matchLocationByIp(null, offices)).toBeNull();
    expect(matchLocationByIp(undefined, offices)).toBeNull();
    expect(matchLocationByIp('', offices)).toBeNull();
  });

  it('ignores malformed CIDR entries instead of crashing', () => {
    const bad = [
      { id: 1, active: true, kiosk_ip_cidrs: ['not-a-cidr', '174.79.61.56/32'] },
    ];
    expect(matchLocationByIp('174.79.61.56', bad)?.id).toBe(1);
  });

  it('IPv4 client never matches an IPv6-only office', () => {
    const v6only = [{ id: 3, active: true, kiosk_ip_cidrs: ['2001:579:8064:95::/64'] }];
    expect(matchLocationByIp('174.79.61.56', v6only)).toBeNull();
  });

  it('IPv6 client never matches an IPv4-only office', () => {
    const v4only = [{ id: 2, active: true, kiosk_ip_cidrs: ['174.79.61.56/32'] }];
    expect(matchLocationByIp('2001:579:8064:95::1', v4only)).toBeNull();
  });

  it('first-match wins when offices have overlapping CIDRs (lowest id by SQL ORDER BY)', () => {
    // Caller passes locations ORDER BY id; allowlist match returns lowest id.
    const overlapping = [
      { id: 1, active: true, kiosk_ip_cidrs: ['10.0.0.0/8'] },
      { id: 2, active: true, kiosk_ip_cidrs: ['10.0.0.0/16'] },
    ];
    expect(matchLocationByIp('10.0.5.5', overlapping)?.id).toBe(1);
  });
});
