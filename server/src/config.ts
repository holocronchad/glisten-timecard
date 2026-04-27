// Centralized env-var access. Fail fast if a required value is missing in prod.
import 'dotenv/config';

function required(name: string): string {
  const v = process.env[name];
  if (!v) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return v;
}

function optional(name: string, fallback: string): string {
  return process.env[name] ?? fallback;
}

function num(name: string, fallback: number): number {
  const v = process.env[name];
  if (!v) return fallback;
  const n = parseInt(v, 10);
  if (Number.isNaN(n)) throw new Error(`Env ${name} must be a number, got ${v}`);
  return n;
}

export const config = {
  port: num('PORT', 3001),
  nodeEnv: optional('NODE_ENV', 'development'),
  isProd: process.env.NODE_ENV === 'production',

  databaseUrl: required('DATABASE_URL'),
  dbSchema: optional('DB_SCHEMA', 'timeclock'),

  jwtSecret: required('JWT_SECRET'),
  jwtTtlHours: num('JWT_TTL_HOURS', 8),
  kioskTokenTtlSeconds: num('KIOSK_TOKEN_TTL_SECONDS', 60),

  pinLockoutAfterFails: num('PIN_LOCKOUT_AFTER_FAILS', 5),
  pinLockoutDurationMinutes: num('PIN_LOCKOUT_DURATION_MINUTES', 5),

  autoCloseCron: optional('AUTO_CLOSE_CRON', '59 6 * * *'),
  autoCloseDefaultShiftHours: num('AUTO_CLOSE_DEFAULT_SHIFT_HOURS', 8),

  payPeriodAnchor: optional('PAY_PERIOD_ANCHOR', '2026-01-05'),
  payPeriodLengthDays: num('PAY_PERIOD_LENGTH_DAYS', 14),

  overtimeWeeklyHours: num('OVERTIME_WEEKLY_HOURS', 40),

  timezone: optional('TZ_DISPLAY', 'America/Phoenix'),
} as const;
