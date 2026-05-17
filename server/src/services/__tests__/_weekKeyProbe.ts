// Probe (NOT a test file — underscore prefix keeps vitest from collecting it).
// Re-invoked as a child process under different TZ env by payrollWeekKey.test.ts
// to prove weekKey's process-TZ dependence at the real payroll surface.
//
// Scenario: ONE Phoenix payroll week (Sun-anchored), W2 office employee.
//   Mon–Fri  5 × 8h  = 40h   (all clearly mid-week, mid-day Phoenix)
//   Sat      1 × 4h         (evening, just before the Sat→Sun boundary)
//   Total 44h in a single Phoenix week → CORRECT overtime = 4h (240 min).
// If weekKey mis-buckets the Sat-evening segment into the next week, the two
// sub-weeks are 40h and 4h → 0 OT → employee silently underpaid the OT premium.

import { computeRateBreakdown } from '../payroll';

// Phoenix is UTC-7 year-round (no DST). Build instants from Phoenix wall time.
// 2026-05-11 is a Monday; the Sun-anchored week start is 2026-05-10.
function phx(dateYMD: string, hh: number, mm = 0): Date {
  // Phoenix wall (UTC-7) → UTC instant.
  return new Date(`${dateYMD}T${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:00-07:00`);
}

function seg(startD: Date, hours: number) {
  return {
    start: startD,
    end: new Date(startD.getTime() + hours * 3600_000),
    paid: true,
    location_id: 1 as number | null, // office bucket
  };
}

const segments = [
  seg(phx('2026-05-11', 9), 8), // Mon
  seg(phx('2026-05-12', 9), 8), // Tue
  seg(phx('2026-05-13', 9), 8), // Wed
  seg(phx('2026-05-14', 9), 8), // Thu
  seg(phx('2026-05-15', 9), 8), // Fri  → 40h so far
  seg(phx('2026-05-16', 20), 4), // Sat 8pm–midnight Phoenix (boundary-adjacent)
];

const br = computeRateBreakdown(
  segments,
  'W2',
  3000, // $30/h office
  3000, // wfh == office (single rate)
  40 * 60, // OT threshold minutes
  'America/Phoenix',
);

process.stdout.write(
  JSON.stringify({
    tz: process.env.TZ ?? '<unset>',
    intlTz: Intl.DateTimeFormat().resolvedOptions().timeZone,
    overtime_office_minutes: br.overtime_office_minutes,
    regular_office_minutes: br.regular_office_minutes,
    total_pay_cents: br.total_pay_cents,
  }),
);
