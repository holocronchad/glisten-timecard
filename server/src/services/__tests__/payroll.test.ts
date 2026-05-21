import { describe, it, expect } from 'vitest';
import { rowsToCsv, computeRateBreakdown, type PayrollRow } from '../payroll';

// Minimal helper to build a PayrollRow without restating every field.
function row(overrides: Partial<PayrollRow>): PayrollRow {
  return {
    user_id: 1,
    name: 'Test User',
    role: 'Front desk',
    employment_type: 'W2',
    regular_office_minutes: 0,
    regular_wfh_minutes: 0,
    overtime_office_minutes: 0,
    overtime_wfh_minutes: 0,
    office_rate_cents: 0,
    wfh_rate_cents: 0,
    office_pay_cents: 0,
    wfh_pay_cents: 0,
    total_pay_cents: 0,
    open_segments: 0,
    flagged_punches: 0,
    ...overrides,
  };
}

describe('rowsToCsv', () => {
  it('emits a header row and one row per employee', () => {
    const rows: PayrollRow[] = [
      row({
        user_id: 1,
        name: 'Annie Simmons',
        role: 'Front desk',
        employment_type: 'W2',
        regular_office_minutes: 60 * 38,
        office_rate_cents: 2500,
        office_pay_cents: 95000, // 38h × $25 = $950
        total_pay_cents: 95000,
        flagged_punches: 1,
      }),
    ];
    const csv = rowsToCsv(rows, '2026-04-27 → 2026-05-10');
    const lines = csv.trim().split('\n');
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain('name');
    expect(lines[0]).toContain('regular_office_hours');
    expect(lines[0]).toContain('regular_wfh_hours');
    expect(lines[0]).toContain('overtime_office_hours');
    expect(lines[0]).toContain('total_pay');
    expect(lines[1]).toContain('Annie Simmons');
    expect(lines[1]).toContain('38.00');
    expect(lines[1]).toContain('950.00');
  });

  it('emits split office + WFH columns when an employee has both rates', () => {
    // Filza-style row: 20h office at $31, 15h WFH at $21
    const rows: PayrollRow[] = [
      row({
        user_id: 16,
        name: 'Filza Tirmizi',
        role: 'dental_assistant',
        employment_type: 'W2',
        regular_office_minutes: 60 * 20,
        regular_wfh_minutes: 60 * 15,
        office_rate_cents: 3100,
        wfh_rate_cents: 2100,
        office_pay_cents: 62000,    // 20h × $31 = $620
        wfh_pay_cents: 31500,       // 15h × $21 = $315
        total_pay_cents: 93500,     // $935
      }),
    ];
    const csv = rowsToCsv(rows, 'period');
    expect(csv).toContain('Filza');
    expect(csv).toContain('31.00'); // office rate
    expect(csv).toContain('21.00'); // WFH rate
    expect(csv).toContain('20.00'); // 20 office hours
    expect(csv).toContain('15.00'); // 15 WFH hours
    expect(csv).toContain('620.00'); // office pay
    expect(csv).toContain('315.00'); // WFH pay
    expect(csv).toContain('935.00'); // total pay
  });

  it('quote-escapes names containing commas or quotes', () => {
    const rows: PayrollRow[] = [
      row({ user_id: 2, name: "O'Reilly, Jr.", role: 'Hygienist', employment_type: '1099' }),
      row({ user_id: 3, name: 'Quote "Q" Quotedson', role: 'Tech' }),
    ];
    const csv = rowsToCsv(rows, 'period');
    expect(csv).toContain('"O\'Reilly, Jr."');
    expect(csv).toContain('"Quote ""Q"" Quotedson"');
  });

  it('formats minutes as decimal hours to 2 places', () => {
    const rows: PayrollRow[] = [
      row({
        user_id: 4,
        name: 'Hour-fraction Henry',
        regular_office_minutes: 90, // 1.50 hours
        overtime_office_minutes: 30, // 0.50 hours
      }),
    ];
    const csv = rowsToCsv(rows, 'period');
    expect(csv).toContain('1.50');
    expect(csv).toContain('0.50');
  });

  it('terminates with a newline', () => {
    const csv = rowsToCsv([], 'period');
    expect(csv.endsWith('\n')).toBe(true);
  });
});

describe('computeRateBreakdown lunch-review deduction (migration 015)', () => {
  const tz = 'America/Phoenix';
  const noOt = 40 * 60;

  it('deducts from the office bucket when the rejected shift was on the office PIN', () => {
    // Single 8.5h office shift (location_id=1). Deduction 30 → 510 - 30 = 480
    // office minutes, 0 WFH minutes. At $25/h office → 480/60 * 2500 = 20000c.
    const segs = [
      {
        start: new Date('2026-05-19T15:00:00Z'),
        end: new Date('2026-05-19T23:30:00Z'),
        paid: true,
        location_id: 1,
        lunch_review_deduction_minutes: 30,
      },
    ];
    const b = computeRateBreakdown(segs, 'W2', 2500, 2100, noOt, tz);
    expect(b.regular_office_minutes).toBe(480);
    expect(b.regular_wfh_minutes).toBe(0);
    expect(b.office_pay_cents).toBe(20000);
    expect(b.wfh_pay_cents).toBe(0);
    expect(b.total_pay_cents).toBe(20000);
  });

  it('deducts from the WFH bucket when the rejected shift was on the WFH PIN', () => {
    const segs = [
      {
        start: new Date('2026-05-19T15:00:00Z'),
        end: new Date('2026-05-19T23:30:00Z'),
        paid: true,
        location_id: null,
        lunch_review_deduction_minutes: 30,
      },
    ];
    const b = computeRateBreakdown(segs, 'W2', 2500, 2100, noOt, tz);
    expect(b.regular_office_minutes).toBe(0);
    expect(b.regular_wfh_minutes).toBe(480);
    expect(b.wfh_pay_cents).toBe(480 / 60 * 2100);
  });

  it('zero deduction is identity (approve / pending)', () => {
    const segs = [
      {
        start: new Date('2026-05-19T15:00:00Z'),
        end: new Date('2026-05-19T23:30:00Z'),
        paid: true,
        location_id: 1,
        lunch_review_deduction_minutes: 0,
      },
    ];
    const b = computeRateBreakdown(segs, 'W2', 2500, 2100, noOt, tz);
    expect(b.regular_office_minutes).toBe(510);
  });

  it('missing lunch_review_deduction_minutes is treated as 0 (legacy callers)', () => {
    const segs = [
      {
        start: new Date('2026-05-19T15:00:00Z'),
        end: new Date('2026-05-19T23:30:00Z'),
        paid: true,
        location_id: 1,
      },
    ];
    const b = computeRateBreakdown(segs, 'W2', 2500, 2100, noOt, tz);
    expect(b.regular_office_minutes).toBe(510);
  });

  it('deduction reduces total before OT threshold is applied (employee-favorable)', () => {
    // 7 office shifts × 6h = 42h gross. OT threshold 40h. Without deduction:
    // 40h regular + 2h OT. With 30 min deduction on ONE shift: 41.5h total →
    // 40h regular + 1.5h OT. OT bucket shrinks, regular doesn't grow.
    const segs = Array.from({ length: 7 }, (_, i) => ({
      start: new Date(`2026-05-${17 + i}T15:00:00Z`),
      end: new Date(`2026-05-${17 + i}T21:00:00Z`),
      paid: true,
      location_id: 1,
      lunch_review_deduction_minutes: i === 0 ? 30 : 0,
    }));
    const b = computeRateBreakdown(segs, 'W2', 2500, 2100, noOt, tz);
    // 42h × 60 = 2520. Minus 30 = 2490 total. OT = 2490 - 2400 = 90 min.
    expect(b.regular_office_minutes + b.overtime_office_minutes).toBe(2490);
    expect(b.overtime_office_minutes).toBe(90);
    expect(b.regular_office_minutes).toBe(2400);
  });
});
