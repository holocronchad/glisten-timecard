// Money helpers for the manager UI. The DB stores pay rates as integer
// cents (timeclock.users.pay_rate_cents / pay_rate_cents_remote); humans
// think in dollars. These two functions are the ONLY place dollars↔cents
// conversion happens for editable rates — keep it that way so the rounding
// rule lives in exactly one tested spot. Display-only formatting stays in
// BlurredRate ((cents/100).toFixed(2)); this mirrors that exactly.

export function centsToDollars(cents: number | null | undefined): string {
  if (cents == null) return '';
  return (cents / 100).toFixed(2);
}

export type ParsedDollars =
  | { ok: true; cents: number }
  | { ok: false; error: string };

// Strict: accepts "24", "24.5", "24.50", "$1,250.00". Rejects negatives,
// >2 decimals, junk, and absurd magnitudes (a fat-fingered $2400 instead
// of $24 corrupts a whole payroll run — the server only checks
// nonnegative-int, so this is the real guard). Caller handles empty string
// separately (empty = "leave unchanged" / "no WFH rate", not 0).
export function parseDollarsToCents(input: string): ParsedDollars {
  const cleaned = input.trim().replace(/^\$/, '').replace(/,/g, '').trim();
  if (cleaned === '') return { ok: false, error: 'Enter an amount.' };
  if (!/^\d{1,5}(\.\d{1,2})?$/.test(cleaned)) {
    return {
      ok: false,
      error: 'Use dollars like 24 or 24.50 (max 2 decimals).',
    };
  }
  const cents = Math.round(parseFloat(cleaned) * 100);
  if (!Number.isFinite(cents) || cents < 0) {
    return { ok: false, error: 'Invalid amount.' };
  }
  return { ok: true, cents };
}
