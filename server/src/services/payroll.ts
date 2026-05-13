// CSV export for payroll. One row per employee per pay period.
//
// Rate-split (locked 2026-05-03 with Anas + Dr. Dawood): some employees have
// TWO hourly rates — an office rate (paid when punching with the geofenced
// office PIN) and a WFH rate (paid when punching with the remote PIN that
// bypasses geofence). The office rate lives on `users.pay_rate_cents`; the
// WFH rate lives on `users.pay_rate_cents_remote` (NULL when the employee
// doesn't have a separate WFH rate — fall back to office rate).
//
// Bucket assignment: each Segment carries `location_id` inherited from its
// opening clock_in punch. NULL location_id = WFH rate; numeric = office rate.
//
// OT handling: weekly threshold (default 40h) applies to the SUM of office +
// WFH hours. When OT triggers, the OT minutes come off the office bucket
// first (preserves the higher base bucket; favorable to the employee since
// office rate is typically higher than WFH; legally safe). Per Anas, no
// employee with a WFH rate is scheduled to hit OT in practice — this code
// path is defensive correctness, not the common case.

import { query } from '../db';
import { buildSegments, type PunchLite } from './hours';
import { config } from '../config';

export interface PayrollRow {
  user_id: number;
  name: string;
  role: string;
  employment_type: string;

  // Hours split by rate bucket (minutes — caller divides by 60 for hours).
  regular_office_minutes: number;
  regular_wfh_minutes: number;
  overtime_office_minutes: number;
  overtime_wfh_minutes: number;

  // Rates used (cents/hour). When the employee has no separate WFH rate,
  // wfh_rate_cents == office_rate_cents (single-rate fallback).
  office_rate_cents: number;
  wfh_rate_cents: number;

  // Computed pay (cents). Pre-rounded; safe to sum.
  office_pay_cents: number;
  wfh_pay_cents: number;
  total_pay_cents: number;

  open_segments: number;
  flagged_punches: number;
}

function weekKey(d: Date, tz: string): string {
  // ISO week start = Monday. We anchor to Sunday for US payroll convention.
  const local = new Date(d.toLocaleString('en-US', { timeZone: tz }));
  const dow = local.getDay(); // 0 = Sunday
  const sunday = new Date(local);
  sunday.setDate(local.getDate() - dow);
  return sunday.toISOString().slice(0, 10);
}

/**
 * Compute the rate-bucket breakdown + pay for a SINGLE user given their
 * already-built segments. Shared by payrollForPeriod() and the
 * /employees/:id rate_summary endpoint so both surfaces give identical
 * numbers (no drift between the dashboard and the CSV export).
 *
 * OT rule: when a user crosses 40h/week (W2 only), OT minutes come from
 * the OFFICE bucket first (preserves the WFH base, employee-favorable when
 * office rate is higher than WFH). Per Anas, the only dual-rate employee
 * (Filza) never crosses OT in practice.
 */
export interface RateBreakdown {
  regular_office_minutes: number;
  regular_wfh_minutes: number;
  overtime_office_minutes: number;
  overtime_wfh_minutes: number;
  office_pay_cents: number;
  wfh_pay_cents: number;
  total_pay_cents: number;
}

export function computeRateBreakdown(
  segments: Array<{ start: Date; end: Date; paid: boolean; location_id: number | null }>,
  employmentType: string,
  officeRateCents: number,
  wfhRateCents: number,
  otThresholdMin: number,
  tz: string,
): RateBreakdown {
  type WeekBucket = { office: number; wfh: number };
  const weekly = new Map<string, WeekBucket>();
  for (const s of segments) {
    if (!s.paid) continue;
    const minutes = Math.max(0, Math.round((s.end.getTime() - s.start.getTime()) / 60000));
    const wk = weekKey(s.start, tz);
    if (!weekly.has(wk)) weekly.set(wk, { office: 0, wfh: 0 });
    const b = weekly.get(wk)!;
    if (s.location_id == null) b.wfh += minutes;
    else b.office += minutes;
  }

  let regularOffice = 0, regularWfh = 0;
  let overtimeOffice = 0, overtimeWfh = 0;

  for (const b of weekly.values()) {
    const total = b.office + b.wfh;
    if (employmentType === 'W2' && total > otThresholdMin) {
      const otMins = total - otThresholdMin;
      const otFromOffice = Math.min(otMins, b.office);
      const otFromWfh = otMins - otFromOffice;
      regularOffice += b.office - otFromOffice;
      regularWfh += b.wfh - otFromWfh;
      overtimeOffice += otFromOffice;
      overtimeWfh += otFromWfh;
    } else {
      regularOffice += b.office;
      regularWfh += b.wfh;
    }
  }

  const officePay = (regularOffice / 60) * officeRateCents +
                    (overtimeOffice / 60) * officeRateCents * 1.5;
  const wfhPay = (regularWfh / 60) * wfhRateCents +
                 (overtimeWfh / 60) * wfhRateCents * 1.5;

  return {
    regular_office_minutes: regularOffice,
    regular_wfh_minutes: regularWfh,
    overtime_office_minutes: overtimeOffice,
    overtime_wfh_minutes: overtimeWfh,
    office_pay_cents: Math.round(officePay),
    wfh_pay_cents: Math.round(wfhPay),
    total_pay_cents: Math.round(officePay + wfhPay),
  };
}

export async function payrollForPeriod(
  start: Date,
  end: Date,
  tz: string = config.timezone,
  homeLocationId: number | null = null,
): Promise<PayrollRow[]> {
  // Payroll always rolls to a user's HOME office regardless of where punches
  // happened (Anas rule, locked 2026-05-01). When homeLocationId is provided,
  // only include staff whose home_location_id matches.
  const { rows: users } = await query<{
    id: number;
    name: string;
    role: string;
    employment_type: string;
    track_hours: boolean;
    pay_rate_cents: number | null;
    pay_rate_cents_remote: number | null;
  }>(
    homeLocationId === null
      ? `SELECT id, name, role, employment_type, track_hours,
                pay_rate_cents, pay_rate_cents_remote
         FROM timeclock.users
         WHERE active = true AND track_hours = true AND approved = true
         ORDER BY name`
      : `SELECT id, name, role, employment_type, track_hours,
                pay_rate_cents, pay_rate_cents_remote
         FROM timeclock.users
         WHERE active = true AND track_hours = true AND approved = true
           AND home_location_id = $1
         ORDER BY name`,
    homeLocationId === null ? [] : [homeLocationId],
  );

  // Pull location_id on each punch so rate bucketing works downstream.
  const { rows: punches } = await query<PunchLite & { ts: Date; location_id: number | null }>(
    `SELECT id, user_id, type, ts, location_id, flagged, auto_closed_at
     FROM timeclock.punches
     WHERE ts >= $1 AND ts < $2
     ORDER BY ts ASC`,
    [start, end],
  );

  const result: PayrollRow[] = [];
  const otThresholdMin = config.overtimeWeeklyHours * 60;

  // Cap open shifts at MIN(period.end, now). For past pay periods this
  // is just period.end. For the CURRENT period, an employee on the clock
  // has their open shift counted up to NOW, not period.end — without
  // this cap, a CSV exported mid-period would inflate hours by hundreds
  // of hours. (Bug found 2026-05-04 by hunting; fixed everywhere.)
  const openCap = new Date(Math.min(end.getTime(), Date.now()));
  for (const u of users) {
    const userPunches = punches.filter((p) => p.user_id === u.id);
    const segments = buildSegments(userPunches, openCap);

    const officeRate = u.pay_rate_cents ?? 0;
    // No separate WFH rate set → fall back to office rate (single-rate user).
    const wfhRate = u.pay_rate_cents_remote ?? officeRate;
    const breakdown = computeRateBreakdown(
      segments,
      u.employment_type,
      officeRate,
      wfhRate,
      otThresholdMin,
      tz,
    );

    const open = segments.filter((s) => s.open).length;
    const flagged = userPunches.filter((p) => p.flagged).length;

    result.push({
      user_id: u.id,
      name: u.name,
      role: u.role,
      employment_type: u.employment_type,
      ...breakdown,
      office_rate_cents: officeRate,
      wfh_rate_cents: wfhRate,
      open_segments: open,
      flagged_punches: flagged,
    });
  }
  return result;
}

export function rowsToCsv(rows: PayrollRow[], periodLabel: string): string {
  const header = [
    'name',
    'role',
    'employment_type',
    'office_rate_per_hour',
    'wfh_rate_per_hour',
    'regular_office_hours',
    'regular_wfh_hours',
    'overtime_office_hours',
    'overtime_wfh_hours',
    'office_pay',
    'wfh_pay',
    'total_pay',
    'open_segments',
    'flagged_punches',
    'period',
  ];
  const lines = [header.join(',')];
  for (const r of rows) {
    lines.push(
      [
        csvCell(r.name),
        csvCell(r.role),
        csvCell(r.employment_type),
        (r.office_rate_cents / 100).toFixed(2),
        (r.wfh_rate_cents / 100).toFixed(2),
        (r.regular_office_minutes / 60).toFixed(2),
        (r.regular_wfh_minutes / 60).toFixed(2),
        (r.overtime_office_minutes / 60).toFixed(2),
        (r.overtime_wfh_minutes / 60).toFixed(2),
        (r.office_pay_cents / 100).toFixed(2),
        (r.wfh_pay_cents / 100).toFixed(2),
        (r.total_pay_cents / 100).toFixed(2),
        r.open_segments.toString(),
        r.flagged_punches.toString(),
        csvCell(periodLabel),
      ].join(','),
    );
  }
  return lines.join('\n') + '\n';
}

function csvCell(v: string): string {
  if (/[",\n]/.test(v)) return `"${v.replace(/"/g, '""')}"`;
  return v;
}
