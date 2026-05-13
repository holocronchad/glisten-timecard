import { describe, it, expect } from 'vitest';
import { rowsToCsv, type PayrollRow } from '../payroll';

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
