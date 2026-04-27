// Bi-weekly pay-period math. Anchor is a known period start in YYYY-MM-DD.
// Every period is exactly N days (default 14). All math in display TZ
// to avoid period-boundary drift across DST/UTC.

import { config } from '../config';

const DAY_MS = 24 * 60 * 60 * 1000;

function startOfDayInTz(date: Date, tz: string): Date {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const y = parts.find((p) => p.type === 'year')!.value;
  const m = parts.find((p) => p.type === 'month')!.value;
  const d = parts.find((p) => p.type === 'day')!.value;
  return new Date(`${y}-${m}-${d}T00:00:00${offsetForTz(tz, date)}`);
}

function offsetForTz(tz: string, date: Date): string {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    timeZoneName: 'longOffset',
  });
  const parts = dtf.formatToParts(date);
  const tzPart = parts.find((p) => p.type === 'timeZoneName')?.value ?? 'GMT+00:00';
  const m = tzPart.match(/GMT([+-]\d{2}:\d{2})/);
  return m ? m[1] : '+00:00';
}

export interface PayPeriod {
  index: number;
  start: Date;
  end: Date; // exclusive
  label: string;
}

export function periodForDate(
  date: Date = new Date(),
  anchorIso: string = config.payPeriodAnchor,
  lengthDays: number = config.payPeriodLengthDays,
  tz: string = config.timezone,
): PayPeriod {
  const anchor = startOfDayInTz(new Date(`${anchorIso}T12:00:00Z`), tz);
  const cursor = startOfDayInTz(date, tz);
  const diffDays = Math.floor((cursor.getTime() - anchor.getTime()) / DAY_MS);
  const index = Math.floor(diffDays / lengthDays);
  const start = new Date(anchor.getTime() + index * lengthDays * DAY_MS);
  const end = new Date(start.getTime() + lengthDays * DAY_MS);
  return {
    index,
    start,
    end,
    label: `${start.toISOString().slice(0, 10)} → ${new Date(end.getTime() - 1).toISOString().slice(0, 10)}`,
  };
}

export function periodByIndex(
  index: number,
  anchorIso: string = config.payPeriodAnchor,
  lengthDays: number = config.payPeriodLengthDays,
  tz: string = config.timezone,
): PayPeriod {
  const anchor = startOfDayInTz(new Date(`${anchorIso}T12:00:00Z`), tz);
  const start = new Date(anchor.getTime() + index * lengthDays * DAY_MS);
  const end = new Date(start.getTime() + lengthDays * DAY_MS);
  return {
    index,
    start,
    end,
    label: `${start.toISOString().slice(0, 10)} → ${new Date(end.getTime() - 1).toISOString().slice(0, 10)}`,
  };
}
