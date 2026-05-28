// Centralised client-IP extraction.
//
// Order of preference:
//   1. cf-connecting-ip  — Cloudflare's authoritative client header. The
//      timecard sits behind CF proxy in prod, so this is always present
//      for real user traffic.
//   2. x-forwarded-for   — first hop, when CF isn't in front (local dev,
//      direct droplet hits during deploys).
//   3. req.ip            — express's own derivation (trust-proxy aware).
//
// Returns null only if nothing usable is set, which in practice happens
// only on synthetic in-process test requests.

import type { Request } from 'express';

export function clientIp(req: Request): string | null {
  const cf = req.headers['cf-connecting-ip'];
  if (typeof cf === 'string' && cf.length > 0) return cf.trim();

  const xff = req.headers['x-forwarded-for'];
  if (typeof xff === 'string' && xff.length > 0) {
    const first = xff.split(',')[0]?.trim();
    if (first) return first;
  }

  return req.ip ?? null;
}
