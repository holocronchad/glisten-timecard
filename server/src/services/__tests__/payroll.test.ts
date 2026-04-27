import { describe, it, expect } from 'vitest';
import { rowsToCsv, type PayrollRow } from '../payroll';

describe('rowsToCsv', () => {
  it('emits a header row and one row per employee', () => {
    const rows: PayrollRow[] = [
      {
        user_id: 1,
        name: 'Annie Simmons',
        role: 'Front desk',
        employment_type: 'W2',
        regular_minutes: 60 * 38,
        overtime_minutes: 0,
        open_segments: 0,
        flagged_punches: 1,
      },
    ];
    const csv = rowsToCsv(rows, '2026-04-27 → 2026-05-10');
    const lines = csv.trim().split('\n');
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain('name');
    expect(lines[0]).toContain('regular_hours');
    expect(lines[0]).toContain('overtime_hours');
    expect(lines[1]).toContain('Annie Simmons');
    expect(lines[1]).toContain('38.00');
    expect(lines[1]).toContain('0.00');
  });

  it('quote-escapes names containing commas or quotes', () => {
    const rows: PayrollRow[] = [
      {
        user_id: 2,
        name: 'O\'Reilly, Jr.',
        role: 'Hygienist',
        employment_type: '1099',
        regular_minutes: 0,
        overtime_minutes: 0,
        open_segments: 0,
        flagged_punches: 0,
      },
      {
        user_id: 3,
        name: 'Quote "Q" Quotedson',
        role: 'Tech',
        employment_type: 'W2',
        regular_minutes: 0,
        overtime_minutes: 0,
        open_segments: 0,
        flagged_punches: 0,
      },
    ];
    const csv = rowsToCsv(rows, 'period');
    expect(csv).toContain('"O\'Reilly, Jr."');
    expect(csv).toContain('"Quote ""Q"" Quotedson"');
  });

  it('formats minutes as decimal hours to 2 places', () => {
    const rows: PayrollRow[] = [
      {
        user_id: 4,
        name: 'Hour-fraction Henry',
        role: 'Front desk',
        employment_type: 'W2',
        regular_minutes: 90, // 1.50 hours
        overtime_minutes: 30, // 0.50 hours
        open_segments: 0,
        flagged_punches: 0,
      },
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
