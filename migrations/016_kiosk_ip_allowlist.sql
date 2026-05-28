-- Kiosk IP allowlist per office (Anas, 2026-05-28).
--
-- Problem: desktop kiosks at Glisten offices have no GPS hardware. The
-- browser's geolocation API falls back to WiFi/IP-based positioning, which
-- can drift several hundred meters past the office geofence radius (300m).
-- Mesha at Mesa on 2026-05-28 was blocked from clock_in on every Mesa
-- desktop and could only punch from a laptop whose WiFi/GPS happened to
-- land inside the fence. clock_in is the strict anti-fraud boundary — the
-- existing geofence relaxation only covers mid-shift transitions.
--
-- Fix: every office can register a list of CIDR ranges that represent its
-- public-internet egress. A punch from any IP inside an office's allowlist
-- is treated as physically present at that office, the way a GPS-inside-
-- fence hit is. The punch is still flagged (flag_reason='ip_allowlist')
-- so the manager dashboard can audit the bypass usage.
--
-- Why CIDR (not TEXT/INET): residential ISPs hand offices a fixed IPv4
-- (Gilbert 98.172.87.245, Mesa 174.79.61.56) but IPv6 clients rotate the
-- host portion every few hours (privacy extensions) within a stable /64
-- prefix (Glendale 2001:579:8064:95::/64). CIDR matching with Postgres's
-- `>>=` operator handles both shapes uniformly.
--
-- Anti-fraud notes:
--   - Office WiFi is strong physical-presence evidence: an attacker
--     cannot fake originating from the office router without owning it.
--   - PIN + brute-force lockout still gates identity.
--   - Allowlist NEVER widens which user can punch, only which physical
--     locations are accepted for a given user's punch.
--   - If an office IP changes (DHCP lease churn at the ISP), the office
--     would see "everyone outside geofence" — re-run discovery and
--     UPDATE the array.

BEGIN;

ALTER TABLE timeclock.locations
  ADD COLUMN IF NOT EXISTS kiosk_ip_cidrs CIDR[] NOT NULL DEFAULT '{}';

INSERT INTO timeclock.schema_versions (version) VALUES ('016_kiosk_ip_allowlist')
  ON CONFLICT DO NOTHING;

COMMIT;
