// Proves the payroll.weekKey() server-TZ-dependence bug at the real payroll
// surface (computeRateBreakdown → overtime minutes → pay), and guards the fix.
//
// V8 caches the timezone at process start, so a single in-process vitest run
// cannot exercise multiple TZs. We re-invoke a probe as child processes with
// TZ ∈ {UTC, America/Phoenix, America/New_York}.
//
// Correct result for the canonical scenario (one Phoenix payroll week, 44h):
//   overtime_office_minutes === 240  (4h OT), regardless of process TZ.
//
// Pre-fix expectation (documents the bug + why prod hasn't been mispaying):
//   TZ=UTC               → 240   (weekKey accidentally correct only under UTC)
//   TZ=America/Phoenix    → 0     (Sat segment mis-bucketed → split week → no OT)
//   TZ=America/New_York   → 0
// Post-fix: 240 under ALL three (TZ-independent) AND UTC value unchanged
// (== 240) so no current paycheck moves.

import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const probe = path.join(here, '_weekKeyProbe.ts');

// Resolve the tsx loader (server devDep; workspace may hoist to repo root).
function tsxBin(): string {
  const candidates = [
    path.resolve(here, '../../../node_modules/.bin/tsx'),
    path.resolve(here, '../../../../node_modules/.bin/tsx'),
  ];
  const found = candidates.find((c) => existsSync(c));
  if (!found) throw new Error('tsx binary not found in node_modules/.bin');
  return found;
}

function runUnder(tz: string): { overtime_office_minutes: number; intlTz: string } {
  const out = execFileSync(tsxBin(), [probe], {
    env: { ...process.env, TZ: tz },
    encoding: 'utf8',
  });
  return JSON.parse(out);
}

describe('payroll weekKey is TZ-independent (OT bucketing across the Sun boundary)', () => {
  const tzs = ['UTC', 'America/Phoenix', 'America/New_York'];

  it('computes 4h OT for a 44h Phoenix week under EVERY process TZ', () => {
    const results = Object.fromEntries(
      tzs.map((tz) => [tz, runUnder(tz)]),
    );
    // Sanity: the child actually adopted the TZ.
    expect(results['UTC'].intlTz).toBe('UTC');
    expect(results['America/Phoenix'].intlTz).toBe('America/Phoenix');

    for (const tz of tzs) {
      expect(
        results[tz].overtime_office_minutes,
        `OT minutes under TZ=${tz} (expected 240; a Phoenix 44h week is 4h OT)`,
      ).toBe(240);
    }
  });

  it('UTC result is exactly 240 — proves the fix does not move any current paycheck (prod runs UTC)', () => {
    expect(runUnder('UTC').overtime_office_minutes).toBe(240);
  });
});
