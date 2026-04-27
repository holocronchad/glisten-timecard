// CSV export for payroll. One row per employee per pay period.
// Columns: name, role, employment_type, regular_minutes, overtime_minutes,
// open_segments, flagged_punches, period_start, period_end.

import { query } from '../db';
import { buildSegments, totalsByDay, type PunchLite } from './hours';
import { config } from '../config';

export interface PayrollRow {
  user_id: number;
  name: string;
  role: string;
  employment_type: string;
  regular_minutes: number;
  overtime_minutes: number;
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

export async function payrollForPeriod(
  start: Date,
  end: Date,
  tz: string = config.timezone,
): Promise<PayrollRow[]> {
  const { rows: users } = await query<{
    id: number;
    name: string;
    role: string;
    employment_type: string;
    track_hours: boolean;
  }>(
    `SELECT id, name, role, employment_type, track_hours
     FROM timeclock.users
     WHERE active = true AND track_hours = true
     ORDER BY name`,
  );

  const { rows: punches } = await query<PunchLite & { ts: Date }>(
    `SELECT id, user_id, type, ts, flagged, auto_closed_at
     FROM timeclock.punches
     WHERE ts >= $1 AND ts < $2
     ORDER BY ts ASC`,
    [start, end],
  );

  const result: PayrollRow[] = [];
  const otThresholdMin = config.overtimeWeeklyHours * 60;

  for (const u of users) {
    const userPunches = punches.filter((p) => p.user_id === u.id);
    const segments = buildSegments(userPunches, end);

    // Bucket paid minutes by week → split regular vs OT (W2 only)
    const weekly = new Map<string, number>();
    for (const s of segments) {
      if (!s.paid) continue;
      const minutes = Math.max(0, Math.round((s.end.getTime() - s.start.getTime()) / 60000));
      const wk = weekKey(s.start, tz);
      weekly.set(wk, (weekly.get(wk) ?? 0) + minutes);
    }

    let regular = 0;
    let overtime = 0;
    for (const minutes of weekly.values()) {
      if (u.employment_type === 'W2' && minutes > otThresholdMin) {
        regular += otThresholdMin;
        overtime += minutes - otThresholdMin;
      } else {
        regular += minutes;
      }
    }

    const open = segments.filter((s) => s.open).length;
    const flagged = userPunches.filter((p) => p.flagged).length;

    result.push({
      user_id: u.id,
      name: u.name,
      role: u.role,
      employment_type: u.employment_type,
      regular_minutes: regular,
      overtime_minutes: overtime,
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
    'regular_hours',
    'overtime_hours',
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
        (r.regular_minutes / 60).toFixed(2),
        (r.overtime_minutes / 60).toFixed(2),
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
