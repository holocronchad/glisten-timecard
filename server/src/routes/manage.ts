// Manager dashboard endpoints. JWT-protected (requireManager).
// Owner-only endpoints use requireOwner: pay rate edits, payroll export,
// staff create/disable.

import { Router } from 'express';
import bcrypt from 'bcrypt';
import { z } from 'zod';
import { query, withTransaction } from '../db';
import { requireManager, requireOwner } from '../auth/middleware';
import { signManagerToken } from '../auth/jwt';
import { findUserByPin, hashPin } from '../auth/pin';
import {
  recordPunch,
  type PunchType,
  type PunchSource,
} from '../services/punches';
import { buildSegments, totalsByDay, totalMinutes } from '../services/hours';
import { payrollForPeriod, rowsToCsv, computeRateBreakdown } from '../services/payroll';
import {
  periodForLocation,
  periodByIndexForLocation,
  periodForUser,
  defaultLocationId,
} from '../services/payPeriod';
import { reviewDays } from '../services/anomalies';
import { runAutoClose } from '../jobs/autoClose';
import { config } from '../config';

const router = Router();

// ── POST /manage/login ─────────────────────────────────────────────────────
// PIN-only manager login. The same bcrypt hash that gates the kiosk gates the
// portal — but we filter for is_owner OR is_manager. PIN brute-force lockout
// is enforced via findUserByPin.
const loginSchema = z.object({
  pin: z.string().regex(/^\d{4}$/),
});

router.post('/login', async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Bad request' });
    return;
  }
  const { pin } = parsed.data;

  // Best-effort client identifiers for the audit trail. CF puts the real
  // visitor IP in cf-connecting-ip; fall back to x-forwarded-for and req.ip.
  const ip =
    (req.headers['cf-connecting-ip'] as string) ||
    (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ||
    req.ip ||
    null;
  const userAgent = (req.headers['user-agent'] as string | undefined) ?? null;

  const result = await findUserByPin(pin);
  if (!result.ok) {
    // Failed attempt — log without an actor (we don't know who tried). Useful
    // for "someone tried 8 PINs from this IP" pattern detection. resource_id=0
    // because there's no user behind a failed attempt.
    await query(
      `INSERT INTO timeclock.audit_log
         (actor_user_id, resource_type, resource_id, action, after_state, reason, ip)
       VALUES (NULL, 'session', 0, 'login_fail', $1, $2, $3)`,
      [
        JSON.stringify({ user_agent: userAgent, reason: result.reason }),
        result.reason === 'locked' ? 'PIN locked out' : 'Invalid PIN',
        ip,
      ],
    ).catch(() => {/* never block login response on audit-log failure */});

    if (result.reason === 'locked') {
      res.status(429).json({
        error: 'Locked',
        message: 'Too many wrong attempts. Try again in a few minutes.',
        locked_until: result.lockedUntil?.toISOString(),
      });
      return;
    }
    res.status(401).json({ error: 'Invalid PIN' });
    return;
  }

  const user = result.user;
  if (!user.is_manager && !user.is_owner) {
    // Logged-in but not a manager — record the gate denial too.
    await query(
      `INSERT INTO timeclock.audit_log
         (actor_user_id, resource_type, resource_id, action, after_state, reason, ip)
       VALUES ($1, 'session', $1, 'login_denied', $2, $3, $4)`,
      [
        user.id,
        JSON.stringify({ user_agent: userAgent }),
        'Not a manager',
        ip,
      ],
    ).catch(() => {});
    res.status(403).json({ error: 'Not a manager' });
    return;
  }
  await query(`UPDATE timeclock.users SET last_login_at = NOW() WHERE id = $1`, [user.id]);

  // Successful manager login → audit trail entry. resource_id = user.id so
  // filtering by actor or resource both surface it. action='login' picks up
  // the Login icon in the UI.
  await query(
    `INSERT INTO timeclock.audit_log
       (actor_user_id, resource_type, resource_id, action, after_state, reason, ip)
     VALUES ($1, 'session', $1, 'login', $2, $3, $4)`,
    [
      user.id,
      JSON.stringify({
        user_agent: userAgent,
        role: user.is_owner ? 'owner' : 'manager',
      }),
      `Logged into manager portal`,
      ip,
    ],
  ).catch(() => {});

  const token = signManagerToken({
    user_id: user.id,
    is_owner: user.is_owner,
    is_manager: user.is_manager,
  });
  res.json({
    token,
    user: {
      id: user.id,
      name: user.name,
      is_owner: user.is_owner,
      is_manager: user.is_manager,
    },
  });
});

router.use(requireManager);

// ── GET /manage/me ─────────────────────────────────────────────────────────
router.get('/me', async (req, res) => {
  const { rows } = await query(
    `SELECT id, name, email, is_owner, is_manager, role
     FROM timeclock.users WHERE id = $1`,
    [req.auth!.user_id],
  );
  res.json({ user: rows[0] ?? null });
});

// ── GET /manage/brief ──────────────────────────────────────────────────────
// Personalized briefing for the current logged-in manager: what's happened
// since their last login + what currently needs attention. Replaces the
// "hunt around 5 tabs" workflow with a single one-screen sentence.
router.get('/brief', async (req, res) => {
  // Find this manager's previous login (we just logged THIS one a moment ago,
  // so the second-most-recent is "since last time").
  const { rows: prevLogins } = await query<{ ts: string }>(
    `SELECT a.ts::text AS ts
     FROM timeclock.audit_log a
     WHERE a.actor_user_id = $1
       AND a.resource_type = 'session'
       AND a.action = 'login'
     ORDER BY a.ts DESC
     LIMIT 2`,
    [req.auth!.user_id],
  );
  // Index 1 = previous login (skip the current one). If only one ever, fall
  // back to last_login_at-on-user (legacy field) or 7 days ago.
  let sinceTs: Date;
  if (prevLogins.length >= 2) {
    sinceTs = new Date(prevLogins[1].ts);
  } else {
    const { rows: u } = await query<{ last_login_at: Date | null }>(
      `SELECT last_login_at FROM timeclock.users WHERE id = $1`,
      [req.auth!.user_id],
    );
    sinceTs = u[0]?.last_login_at
      ? new Date(u[0].last_login_at)
      : new Date(Date.now() - 7 * 24 * 60 * 60_000);
  }

  // 1. Pending missed-punch requests (oldest first so the brief surfaces lag)
  const { rows: pendingMissed } = await query<{
    id: number;
    user_name: string;
    type: string;
    proposed_ts: string;
    reason: string;
    created_at: string;
  }>(
    `SELECT m.id, u.name AS user_name, m.type, m.proposed_ts::text, m.reason, m.created_at::text
     FROM timeclock.missed_punch_requests m
     JOIN timeclock.users u ON u.id = m.user_id
     WHERE m.status = 'pending'
     ORDER BY m.created_at ASC`,
  );

  // 2. Login fails since the last login + login_denied
  const { rows: failedLogins } = await query<{
    id: number;
    action: string;
    ts: string;
    ip: string | null;
    reason: string | null;
  }>(
    `SELECT id, action, ts::text, ip::text AS ip, reason
     FROM timeclock.audit_log
     WHERE resource_type = 'session'
       AND action IN ('login_fail', 'login_denied', 'kiosk_pin_fail', 'me_pin_fail')
       AND ts > $1
     ORDER BY ts DESC
     LIMIT 50`,
    [sinceTs],
  );

  // 3. Currently-on-the-clock count (open paid segments today)
  const azNow = new Date();
  const { rows: todayPunches } = await query<any>(
    `SELECT id, user_id, type, ts, location_id, flagged, auto_closed_at
     FROM timeclock.punches
     WHERE ts >= NOW() - INTERVAL '36 hours'
     ORDER BY ts ASC`,
  );
  const userIds = [...new Set(todayPunches.map((p: any) => p.user_id))];
  let onClock = 0;
  for (const uid of userIds) {
    const userPunches = todayPunches.filter((p: any) => p.user_id === uid);
    const segs = buildSegments(userPunches, azNow);
    if (segs.some((s) => s.open)) onClock++;
  }

  // 4. Anomalies in the current pay period — top N high-severity items.
  //
  // Each user's anomaly window is THEIR home location's current pay period
  // (since locations have different schedules: Gilbert biweekly vs.
  // Mesa/Glendale semi-monthly). We compute per-user windows, then run one
  // SQL query covering the union of all user windows, then per-user filter
  // when calling reviewDays.
  const { rows: activeUsers } = await query<{
    id: number;
    name: string;
    home_location_id: number | null;
  }>(
    `SELECT id, name, home_location_id
     FROM timeclock.users
     WHERE active = true AND track_hours = true AND approved = true`,
  );
  const fallbackLocationId = await defaultLocationId();
  type UserWindow = { period: { start: Date; end: Date }; baselineStart: Date };
  const windowByUser = new Map<number, UserWindow>();
  let unionStart: Date | null = null;
  let unionEnd: Date | null = null;
  for (const u of activeUsers) {
    const locId = u.home_location_id ?? fallbackLocationId;
    const p = await periodForLocation(locId, new Date());
    const baselineStart = new Date(p.start.getTime() - 14 * 24 * 60 * 60_000);
    windowByUser.set(u.id, { period: { start: p.start, end: p.end }, baselineStart });
    if (unionStart === null || baselineStart < unionStart) unionStart = baselineStart;
    if (unionEnd === null || p.end > unionEnd) unionEnd = p.end;
  }
  // Default if no active users with periods (test/empty DB safety)
  if (unionStart === null || unionEnd === null) {
    const fallbackPeriod = await periodForLocation(fallbackLocationId, new Date());
    unionStart = new Date(fallbackPeriod.start.getTime() - 14 * 24 * 60 * 60_000);
    unionEnd = fallbackPeriod.end;
  }

  // Used by the response payload as the "headline" period — the default
  // location's current period. Per-employee anomaly windows still use each
  // employee's home location.
  const period = await periodForLocation(fallbackLocationId, new Date());
  const allUserIds = activeUsers.map((u) => u.id);
  const { rows: periodPunches } = await query<any>(
    `SELECT id, user_id, type, ts, location_id, flagged, auto_closed_at
     FROM timeclock.punches
     WHERE user_id = ANY($1::int[]) AND ts >= $2 AND ts < $3
     ORDER BY ts ASC`,
    [allUserIds, unionStart, unionEnd],
  );
  // Baseline punches: use a 14-day window before the EARLIEST per-user period
  // start (so every user has at least 14 days of baseline available).
  const periodBaseline = periodPunches.filter((p: any) => {
    const w = windowByUser.get(p.user_id);
    if (!w) return false;
    return p.ts >= w.baselineStart && p.ts < w.period.start;
  });
  // Re-slice periodPunches array against per-user period (in-memory filter
  // happens in the loop below). For now keep `periodPunches` as the union set
  // and let reviewDays do the user-specific window enforcement.
  const { rows: periodMissedPending } = await query<{ user_id: number; date: string; cnt: string }>(
    `SELECT user_id, to_char(date, 'YYYY-MM-DD') AS date, COUNT(*)::text AS cnt
     FROM timeclock.missed_punch_requests
     WHERE status = 'pending' AND user_id = ANY($1::int[])
       AND date >= $2 AND date < $3
     GROUP BY user_id, date`,
    [allUserIds, unionStart, unionEnd],
  );
  const missedByUserDate = new Map<number, Map<string, number>>();
  for (const r of periodMissedPending) {
    if (!missedByUserDate.has(r.user_id)) missedByUserDate.set(r.user_id, new Map());
    missedByUserDate.get(r.user_id)!.set(r.date, parseInt(r.cnt, 10));
  }

  type FlaggedItem = {
    user_id: number;
    user_name: string;
    date: string;
    severity: 'high' | 'medium' | 'low';
    type: string;
    message: string;
  };
  const flaggedItems: FlaggedItem[] = [];
  for (const u of activeUsers) {
    const w = windowByUser.get(u.id);
    if (!w) continue; // user has no determinable period (skip rather than crash)
    const dayReviews = reviewDays({
      user: { id: u.id, name: u.name, home_location_id: u.home_location_id },
      // Filter to THIS user's period window so per-user period boundaries
      // are respected (e.g., Mesa user only sees punches in semi-monthly half).
      punches: periodPunches.filter(
        (p: any) => p.user_id === u.id && p.ts >= w.period.start && p.ts < w.period.end,
      ),
      baselinePunches: periodBaseline.filter((p: any) => p.user_id === u.id),
      missedPendingByDate: missedByUserDate.get(u.id) ?? new Map(),
      windowStart: w.period.start,
      windowEnd: w.period.end,
    });
    for (const day of dayReviews) {
      for (const a of day.anomalies) {
        // Skip missed_punch_pending — already counted in pendingMissed
        if (a.type === 'missed_punch_pending') continue;
        flaggedItems.push({
          user_id: u.id,
          user_name: u.name,
          date: day.date,
          severity: a.severity,
          type: a.type,
          message: a.message,
        });
      }
    }
  }
  // Sort: high first, then medium, then low; within severity newest date first
  const sevRank = { high: 0, medium: 1, low: 2 } as const;
  flaggedItems.sort((a, b) => {
    const r = sevRank[a.severity] - sevRank[b.severity];
    return r !== 0 ? r : (a.date < b.date ? 1 : -1);
  });

  res.json({
    since: sinceTs.toISOString(),
    on_clock_count: onClock,
    pending_missed: {
      count: pendingMissed.length,
      items: pendingMissed.slice(0, 5), // top 5 oldest
    },
    failed_logins: {
      count: failedLogins.length,
      items: failedLogins.slice(0, 10),
    },
    period_anomalies: {
      total: flaggedItems.length,
      high: flaggedItems.filter((i) => i.severity === 'high').length,
      medium: flaggedItems.filter((i) => i.severity === 'medium').length,
      items: flaggedItems.slice(0, 8),
    },
    period: { index: period.index, label: period.label },
  });
});

// ── GET /manage/today ──────────────────────────────────────────────────────
// Per-employee status today. Active staff only.
router.get('/today', async (req, res) => {
  const { rows: users } = await query<{
    id: number;
    name: string;
    role: string;
    approved: boolean;
    self_registered: boolean;
  }>(
    `SELECT id, name, role, approved, self_registered
     FROM timeclock.users
     WHERE active = true AND track_hours = true
     ORDER BY name`,
  );

  const { rows: punches } = await query<any>(
    `SELECT id, user_id, location_id, type, ts, flagged, source
     FROM timeclock.punches
     WHERE ts >= NOW() - INTERVAL '36 hours'
     ORDER BY ts ASC`,
  );

  const tz = config.timezone;
  const today = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());

  const out = users.map((u) => {
    const userPunches = punches.filter((p) => p.user_id === u.id);
    const today_punches = userPunches.filter(
      (p) =>
        new Intl.DateTimeFormat('en-CA', {
          timeZone: tz,
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
        }).format(new Date(p.ts)) === today,
    );
    const segments = buildSegments(today_punches);
    const minutes = totalMinutes(segments);
    const last = userPunches[userPunches.length - 1] ?? null;
    const status = last
      ? last.type === 'clock_in' || last.type === 'lunch_end'
        ? 'on_clock'
        : last.type === 'lunch_start'
          ? 'on_lunch'
          : 'off'
      : 'off';
    return {
      user: u,
      status,
      worked_minutes_today: minutes,
      last_punch: last
        ? {
            id: last.id,
            type: last.type,
            ts: last.ts,
            flagged: last.flagged,
            // Surface PIN type used for the punch. WFH PIN bypasses geofence
            // and records location_id=null; office PIN binds to a location.
            // Manager dashboard uses this to show "WFH" vs "Office: Gilbert"
            // next to who's currently on the clock — paid at different rates.
            location_id: last.location_id ?? null,
            is_wfh: last.location_id == null,
          }
        : null,
    };
  });

  // Lunch review pending count drives the new "Lunch Review" tab badge in
  // ManageShell. Cheap query — partial index on lunch_review_status='pending'.
  // Scoped to manager's home location for non-owners, matching the
  // /lunch-reviews queue scoping.
  let lunchCountSql = `SELECT COUNT(*)::text AS count
                       FROM timeclock.punches p
                       WHERE p.lunch_review_status = 'pending'`;
  const lunchCountParams: any[] = [];
  if (!req.auth!.is_owner) {
    const { rows: meRows } = await query<{ home_location_id: number | null }>(
      `SELECT home_location_id FROM timeclock.users WHERE id = $1`,
      [req.auth!.user_id],
    );
    const homeLoc = meRows[0]?.home_location_id ?? null;
    if (homeLoc !== null) {
      lunchCountSql += ` AND EXISTS (
        SELECT 1 FROM timeclock.users u
        WHERE u.id = p.user_id AND u.home_location_id = $1
      )`;
      lunchCountParams.push(homeLoc);
    } else {
      // Manager with no home location — show 0 instead of leaking global count.
      lunchCountSql = `SELECT '0'::text AS count`;
    }
  }
  const { rows: lunchRows } = await query<{ count: string }>(lunchCountSql, lunchCountParams);
  const lunch_review_count = parseInt(lunchRows[0]?.count ?? '0', 10);

  res.json({
    today,
    employees: out,
    pending_count: users.filter((u) => !u.approved).length,
    lunch_review_count,
  });
});

// ── GET /manage/pending ────────────────────────────────────────────────────
// Self-registered employees awaiting manager approval.
router.get('/pending', async (_req, res) => {
  const { rows } = await query(
    `SELECT u.id, u.name, u.role, u.created_at, u.cpr_org, u.cpr_expires_at,
            COUNT(p.id) AS punch_count,
            MIN(p.ts) AS first_punch_at,
            MAX(p.ts) AS last_punch_at
     FROM timeclock.users u
     LEFT JOIN timeclock.punches p ON p.user_id = u.id
     WHERE u.active = true AND u.approved = false AND u.track_hours = true
     GROUP BY u.id
     ORDER BY u.created_at DESC`,
  );
  res.json({ pending: rows });
});

// ── POST /manage/users/:id/approve ─────────────────────────────────────────
const decisionSchema = z.object({
  reason: z.string().max(500).optional(),
});

router.post('/users/:id/approve', async (req, res) => {
  const id = parseInt(String(req.params.id), 10);
  if (Number.isNaN(id)) {
    res.status(400).json({ error: 'Bad id' });
    return;
  }
  const parsed = decisionSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: 'Bad request' });
    return;
  }

  type Result =
    | { ok: true; user: any }
    | { ok: false; status: number; error: string };

  const result = await withTransaction<Result>(async (client) => {
    const before = await client.query(
      `SELECT id, name, approved FROM timeclock.users WHERE id = $1 FOR UPDATE`,
      [id],
    );
    if (before.rowCount === 0) {
      return { ok: false, status: 404, error: 'Not found' };
    }
    if (before.rows[0].approved === true) {
      return { ok: false, status: 409, error: 'Already approved' };
    }
    const updated = await client.query(
      `UPDATE timeclock.users
       SET approved = true, approved_by = $1, approved_at = NOW(), updated_at = NOW()
       WHERE id = $2
       RETURNING id, name, role, approved, approved_at`,
      [req.auth!.user_id, id],
    );
    await client.query(
      `INSERT INTO timeclock.audit_log
         (actor_user_id, resource_type, resource_id, action, before_state, after_state, reason)
       VALUES ($1, 'user', $2, 'approve', $3, $4, $5)`,
      [
        req.auth!.user_id,
        id,
        JSON.stringify(before.rows[0]),
        JSON.stringify(updated.rows[0]),
        parsed.data.reason ?? 'Approved self-registered employee',
      ],
    );
    return { ok: true, user: updated.rows[0] };
  });
  if (!result.ok) {
    res.status(result.status).json({ error: result.error });
    return;
  }
  res.json({ user: result.user });
});

// ── POST /manage/users/:id/deny ────────────────────────────────────────────
// Soft-delete: set active = false. Punches are kept for audit but excluded
// from payroll because payroll filters active = true AND approved = true.
router.post('/users/:id/deny', async (req, res) => {
  const id = parseInt(String(req.params.id), 10);
  if (Number.isNaN(id)) {
    res.status(400).json({ error: 'Bad id' });
    return;
  }
  const parsed = decisionSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: 'Bad request' });
    return;
  }

  type Result =
    | { ok: true }
    | { ok: false; status: number; error: string };

  const result = await withTransaction<Result>(async (client) => {
    const before = await client.query(
      `SELECT id, name, approved, active FROM timeclock.users WHERE id = $1 FOR UPDATE`,
      [id],
    );
    if (before.rowCount === 0) {
      return { ok: false, status: 404, error: 'Not found' };
    }
    if (before.rows[0].approved === true) {
      return { ok: false, status: 409, error: 'Cannot deny an already-approved user' };
    }
    await client.query(
      `UPDATE timeclock.users
       SET active = false, updated_at = NOW()
       WHERE id = $1`,
      [id],
    );
    await client.query(
      `INSERT INTO timeclock.audit_log
         (actor_user_id, resource_type, resource_id, action, before_state, reason)
       VALUES ($1, 'user', $2, 'deny', $3, $4)`,
      [
        req.auth!.user_id,
        id,
        JSON.stringify(before.rows[0]),
        parsed.data.reason ?? 'Denied self-registered employee',
      ],
    );
    return { ok: true };
  });
  if (!result.ok) {
    res.status(result.status).json({ error: result.error });
    return;
  }
  res.json({ ok: true });
});

// ── GET /manage/period ─────────────────────────────────────────────────────
// Pay-period summary. Optional ?index=<int> (default = current period).
// Optional ?location=<id> filters by user.home_location_id (per-office payroll
// view; rule = payroll always rolls to home office regardless of where the
// punch happened).
router.get('/period', async (req, res) => {
  const idxRaw = req.query.index as string | undefined;
  const locRaw = req.query.location as string | undefined;
  const homeLocationId =
    locRaw && /^\d+$/.test(locRaw) ? parseInt(locRaw, 10) : null;
  // Each location has its own pay schedule (Gilbert biweekly, Mesa/Glendale
  // semi-monthly). When no location is selected ("All"), fall back to the
  // location with the largest active roster (currently Gilbert) so the
  // headline period is meaningful.
  const periodLocationId = homeLocationId ?? (await defaultLocationId());
  const period =
    idxRaw !== undefined && /^-?\d+$/.test(idxRaw)
      ? await periodByIndexForLocation(periodLocationId, parseInt(idxRaw, 10))
      : await periodForLocation(periodLocationId, new Date());

  const { rows: users } = await query<{
    id: number;
    name: string;
    employment_type: string;
    pay_rate_cents: number | null;
    pay_rate_cents_remote: number | null;
  }>(
    homeLocationId === null
      ? `SELECT id, name, employment_type, pay_rate_cents, pay_rate_cents_remote
         FROM timeclock.users
         WHERE active = true AND track_hours = true
         ORDER BY name`
      : `SELECT id, name, employment_type, pay_rate_cents, pay_rate_cents_remote
         FROM timeclock.users
         WHERE active = true AND track_hours = true
           AND home_location_id = $1
         ORDER BY name`,
    homeLocationId === null ? [] : [homeLocationId],
  );
  const { rows: punches } = await query<any>(
    `SELECT id, user_id, type, ts, location_id, flagged, auto_closed_at
     FROM timeclock.punches
     WHERE ts >= $1 AND ts < $2
     ORDER BY ts ASC`,
    [period.start, period.end],
  );

  // Pull baselines (14 days before period start) + home_location_id + missed
  // requests for anomaly scoring.
  const baselineStart = new Date(period.start.getTime() - 14 * 24 * 60 * 60_000);
  const userIds = users.map((u) => u.id);
  const { rows: userMeta } = await query<{ id: number; home_location_id: number | null }>(
    `SELECT id, home_location_id FROM timeclock.users WHERE id = ANY($1::int[])`,
    [userIds],
  );
  const homeLocByUser = new Map(userMeta.map((u) => [u.id, u.home_location_id]));

  const { rows: baselinePunches } = await query<any>(
    `SELECT id, user_id, type, ts, location_id, flagged, auto_closed_at
     FROM timeclock.punches
     WHERE user_id = ANY($1::int[]) AND ts >= $2 AND ts < $3
     ORDER BY ts ASC`,
    [userIds, baselineStart, period.start],
  );

  const { rows: missedPending } = await query<{ user_id: number; date: string; cnt: string }>(
    `SELECT user_id, to_char(date, 'YYYY-MM-DD') AS date, COUNT(*)::text AS cnt
     FROM timeclock.missed_punch_requests
     WHERE status = 'pending'
       AND user_id = ANY($1::int[])
       AND date >= $2 AND date < $3
     GROUP BY user_id, date`,
    [userIds, period.start, period.end],
  );
  const missedByUserDate = new Map<number, Map<string, number>>();
  for (const r of missedPending) {
    if (!missedByUserDate.has(r.user_id)) missedByUserDate.set(r.user_id, new Map());
    missedByUserDate.get(r.user_id)!.set(r.date, parseInt(r.cnt, 10));
  }

  // Cap open shifts at MIN(period.end, now). For past periods period.end
  // wins; for the current period now wins so live open shifts don't count
  // toward future hours that haven't happened yet.
  const periodOpenCap = new Date(Math.min(period.end.getTime(), Date.now()));
  const employees = users.map((u) => {
    const userPunches = punches.filter((p) => p.user_id === u.id);
    const segs = buildSegments(userPunches, periodOpenCap);
    const totals = totalsByDay(segs);
    const minutes = totalMinutes(segs);

    // Split worked minutes by rate bucket (location_id IS NULL = WFH PIN
    // → paid at WFH rate; numeric = office PIN → paid at office rate).
    let officeMinutes = 0;
    let wfhMinutes = 0;
    for (const s of segs) {
      if (!s.paid) continue;
      const m = Math.max(0, Math.round((s.end.getTime() - s.start.getTime()) / 60000));
      if (s.location_id == null) wfhMinutes += m;
      else officeMinutes += m;
    }

    const dayReviews = reviewDays({
      user: { id: u.id, name: u.name, home_location_id: homeLocByUser.get(u.id) ?? null },
      punches: userPunches,
      baselinePunches: baselinePunches.filter((p: any) => p.user_id === u.id),
      missedPendingByDate: missedByUserDate.get(u.id) ?? new Map(),
      windowStart: period.start,
      windowEnd: period.end,
    });

    // Aggregate severity counts so the row badge can render at a glance
    let high = 0, medium = 0, low = 0;
    for (const d of dayReviews) {
      for (const a of d.anomalies) {
        if (a.severity === 'high') high++;
        else if (a.severity === 'medium') medium++;
        else low++;
      }
    }

    return {
      user: u,
      total_minutes: minutes,
      office_minutes: officeMinutes,
      wfh_minutes: wfhMinutes,
      // Render the WFH pill in Period.tsx whenever the user has a separate
      // WFH rate, even on a period where they happened to only work one
      // bucket. Stays consistent with EmployeeDetail's rate_summary card.
      has_split_rate: u.pay_rate_cents_remote != null,
      daily_totals: totals,
      flagged_count: userPunches.filter((p) => p.flagged).length,
      open_segments: segs.filter((s) => s.open).length,
      day_reviews: dayReviews,
      anomaly_counts: { high, medium, low, total: high + medium + low },
    };
  });

  // Has this period already been signed by an owner?
  const { rows: signRows } = await query<{
    id: number;
    actor_user_id: number | null;
    actor_name: string | null;
    ts: string;
    after_state: any;
  }>(
    `SELECT a.id, a.actor_user_id, u.name AS actor_name, a.ts, a.after_state
     FROM timeclock.audit_log a
     LEFT JOIN timeclock.users u ON u.id = a.actor_user_id
     WHERE a.resource_type = 'payroll' AND a.action = 'sign'
       AND (a.after_state->>'period_index')::int = $1
       AND COALESCE(a.after_state->>'home_location_id', 'all') = $2
     ORDER BY a.ts DESC LIMIT 1`,
    [period.index, homeLocationId === null ? 'all' : String(homeLocationId)],
  );

  res.json({
    period,
    employees,
    location_id: homeLocationId,
    signed: signRows.length > 0 ? signRows[0] : null,
  });
});

// ── POST /manage/period/sign (owner) ──────────────────────────────────────
// Records a payroll sign-off in the audit log so we know who signed which
// period (+ optional location scope) at what time. Idempotent — signing
// twice creates two audit rows; the latest wins for "is this signed?" UI.
const signSchema = z.object({
  index: z.number().int(),
  location_id: z.number().int().positive().nullable().optional(),
  total_minutes: z.number().int().nonnegative(),
  employee_count: z.number().int().nonnegative(),
  high_anomalies: z.number().int().nonnegative(),
  note: z.string().max(500).optional(),
});

router.post('/period/sign', requireOwner, async (req, res) => {
  const parsed = signSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Bad request' });
    return;
  }
  const periodLocationId = parsed.data.location_id ?? (await defaultLocationId());
  const period = await periodByIndexForLocation(periodLocationId, parsed.data.index);
  await query(
    `INSERT INTO timeclock.audit_log
       (actor_user_id, resource_type, resource_id, action, after_state, reason)
     VALUES ($1, 'payroll', $2, 'sign', $3, $4)`,
    [
      req.auth!.user_id,
      parsed.data.index,
      JSON.stringify({
        period_index: parsed.data.index,
        period_start: period.start.toISOString(),
        period_end: period.end.toISOString(),
        home_location_id: parsed.data.location_id ?? null,
        total_minutes: parsed.data.total_minutes,
        employee_count: parsed.data.employee_count,
        high_anomalies: parsed.data.high_anomalies,
      }),
      parsed.data.note ?? `Signed pay period ${period.label}`,
    ],
  );
  res.json({ ok: true });
});

// ── GET /manage/payroll.csv ────────────────────────────────────────────────
// Optional ?location=<id> filters by home_location_id and includes the office
// short-name in the filename (glisten-payroll-gilbert-YYYY-MM-DD.csv).
router.get('/payroll.csv', requireOwner, async (req, res) => {
  const idxRaw = req.query.index as string | undefined;
  const locRaw = req.query.location as string | undefined;
  const homeLocationId =
    locRaw && /^\d+$/.test(locRaw) ? parseInt(locRaw, 10) : null;
  const periodLocationId = homeLocationId ?? (await defaultLocationId());
  const period =
    idxRaw !== undefined && /^-?\d+$/.test(idxRaw)
      ? await periodByIndexForLocation(periodLocationId, parseInt(idxRaw, 10))
      : await periodForLocation(periodLocationId, new Date());

  let officeSlug = 'all';
  if (homeLocationId !== null) {
    const { rows } = await query<{ name: string }>(
      `SELECT name FROM timeclock.locations WHERE id = $1`,
      [homeLocationId],
    );
    if (rows.length > 0) {
      officeSlug = rows[0].name
        .toLowerCase()
        .replace(/glisten dental /g, '')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
    }
  }

  const rows = await payrollForPeriod(
    period.start,
    period.end,
    config.timezone,
    homeLocationId,
  );
  const csv = rowsToCsv(rows, period.label);
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="glisten-payroll-${officeSlug}-${period.start.toISOString().slice(0, 10)}.csv"`,
  );
  res.send(csv);
});

// ── GET /manage/punches ────────────────────────────────────────────────────
// Filterable punch log: ?user_id, ?from, ?to, ?flagged
router.get('/punches', async (req, res) => {
  const userIdRaw = req.query.user_id as string | undefined;
  const fromRaw = req.query.from as string | undefined;
  const toRaw = req.query.to as string | undefined;
  if (userIdRaw && !/^\d+$/.test(userIdRaw)) {
    res.status(400).json({ error: 'Bad user_id' });
    return;
  }
  const userId = userIdRaw ? parseInt(userIdRaw, 10) : null;
  const from = fromRaw ? new Date(fromRaw) : null;
  const to = toRaw ? new Date(toRaw) : null;
  if ((from && Number.isNaN(from.getTime())) || (to && Number.isNaN(to.getTime()))) {
    res.status(400).json({ error: 'Bad from/to' });
    return;
  }
  const flagged = req.query.flagged === 'true';

  const where: string[] = [];
  const params: any[] = [];
  if (userId) {
    params.push(userId);
    where.push(`p.user_id = $${params.length}`);
  }
  if (from) {
    params.push(from);
    where.push(`p.ts >= $${params.length}`);
  }
  if (to) {
    params.push(to);
    where.push(`p.ts < $${params.length}`);
  }
  if (flagged) where.push(`p.flagged = true`);

  const { rows } = await query(
    `SELECT p.id, p.user_id, u.name AS user_name, p.location_id, l.name AS location_name,
            p.type, p.ts, p.source, p.flagged, p.flag_reason, p.geofence_pass, p.auto_closed_at,
            p.no_lunch_reason
     FROM timeclock.punches p
     JOIN timeclock.users u ON u.id = p.user_id
     LEFT JOIN timeclock.locations l ON l.id = p.location_id
     ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
     ORDER BY p.ts DESC
     LIMIT 500`,
    params,
  );
  res.json({ punches: rows });
});

// ── GET /manage/employees/:id ──────────────────────────────────────────────
// Drill-down for one employee: profile + punches + segments inside an
// optional date range. Three modes (later overrides earlier):
//   default                                — current pay period
//   ?index=<int>                           — specific pay period
//   ?from=YYYY-MM-DD&to=YYYY-MM-DD         — custom range, [from 00:00 AZ, to+1 00:00 AZ)
router.get('/employees/:id', async (req, res) => {
  const id = parseInt(String(req.params.id), 10);
  if (Number.isNaN(id)) {
    res.status(400).json({ error: 'Bad id' });
    return;
  }

  const fromRaw = req.query.from as string | undefined;
  const toRaw = req.query.to as string | undefined;
  const idxRaw = req.query.index as string | undefined;

  // AZ is fixed UTC-7 year-round (no DST), so date-only inputs anchor to -07:00.
  let period: { start: Date; end: Date; label: string; index: number | null };
  if (fromRaw && toRaw && /^\d{4}-\d{2}-\d{2}$/.test(fromRaw) && /^\d{4}-\d{2}-\d{2}$/.test(toRaw)) {
    const start = new Date(`${fromRaw}T00:00:00-07:00`);
    // end is exclusive — bump `to` by 1 day so the inclusive end-date day is fully covered
    const toDate = new Date(`${toRaw}T00:00:00-07:00`);
    const end = new Date(toDate.getTime() + 24 * 60 * 60 * 1000);
    period = {
      start,
      end,
      label: `${fromRaw} → ${toRaw}`,
      index: null,
    };
  } else {
    // Use this employee's home location's pay schedule. periodForUser returns
    // null when no home_location_id is set, so we fall back to the default
    // location (largest active roster) for owners/contractors etc.
    const userPeriodNow = await periodForUser(id);
    const periodLocationId =
      userPeriodNow?.locationId ?? (await defaultLocationId());
    const p =
      idxRaw !== undefined && /^-?\d+$/.test(idxRaw)
        ? await periodByIndexForLocation(periodLocationId, parseInt(idxRaw, 10))
        : await periodForLocation(periodLocationId, new Date());
    period = { start: p.start, end: p.end, label: p.label, index: p.index };
  }

  const { rows: users } = await query(
    `SELECT id, name, email, role, employment_type, pay_rate_cents, pay_rate_cents_remote,
            is_owner, is_manager, track_hours, active, home_location_id,
            cpr_org, cpr_issued_at, cpr_expires_at, cpr_updated_at
     FROM timeclock.users WHERE id = $1`,
    [id],
  );
  if (users.length === 0) {
    res.status(404).json({ error: 'Not found' });
    return;
  }

  const { rows: punches } = await query(
    `SELECT p.id, p.location_id, l.name AS location_name, p.type, p.ts,
            p.source, p.flagged, p.flag_reason, p.geofence_pass, p.auto_closed_at,
            p.no_lunch_reason
     FROM timeclock.punches p
     LEFT JOIN timeclock.locations l ON l.id = p.location_id
     WHERE p.user_id = $1 AND p.ts >= $2 AND p.ts < $3
     ORDER BY p.ts ASC`,
    [id, period.start, period.end],
  );

  const { rows: missed } = await query(
    `SELECT id, type, proposed_ts, reason, status, created_at, decided_at, location_id
     FROM timeclock.missed_punch_requests
     WHERE user_id = $1
     ORDER BY created_at DESC
     LIMIT 30`,
    [id],
  );

  // Build a rate-breakdown summary card. Uses the SAME computeRateBreakdown
  // helper as payrollForPeriod() so the dashboard card and the CSV export
  // give identical numbers — including OT premium math (1.5× on hours
  // exceeding 40/week, OT taken from office bucket first).
  //
  // Cap open shifts at MIN(period.end, now). For past periods period.end
  // wins; for the current period now wins, so an open shift counts up to
  // the present moment.
  const openCap = new Date(Math.min(period.end.getTime(), Date.now()));
  const segs = buildSegments(punches as any, openCap);
  const u = users[0] as any;
  const officeRateCents = u.pay_rate_cents ?? 0;
  // Fall back to office rate when no separate WFH rate is set (single-rate user).
  const wfhRateCents = u.pay_rate_cents_remote ?? officeRateCents;
  const otThresholdMin = config.overtimeWeeklyHours * 60;
  const breakdown = computeRateBreakdown(
    segs,
    u.employment_type,
    officeRateCents,
    wfhRateCents,
    otThresholdMin,
    config.timezone,
  );
  const totalMin =
    breakdown.regular_office_minutes + breakdown.regular_wfh_minutes +
    breakdown.overtime_office_minutes + breakdown.overtime_wfh_minutes;
  const rate_summary = {
    has_split_rate: u.pay_rate_cents_remote !== null,
    office_minutes:
      breakdown.regular_office_minutes + breakdown.overtime_office_minutes,
    wfh_minutes:
      breakdown.regular_wfh_minutes + breakdown.overtime_wfh_minutes,
    total_minutes: totalMin,
    office_rate_cents: officeRateCents,
    wfh_rate_cents: wfhRateCents,
    office_pay_cents: breakdown.office_pay_cents,
    wfh_pay_cents: breakdown.wfh_pay_cents,
    total_pay_cents: breakdown.total_pay_cents,
    // Surface OT minutes too in case the frontend wants to flag a card with
    // OT (currently it just shows aggregate, which matches the CSV total).
    overtime_office_minutes: breakdown.overtime_office_minutes,
    overtime_wfh_minutes: breakdown.overtime_wfh_minutes,
  };

  res.json({
    user: users[0],
    period,
    punches,
    missed,
    rate_summary,
  });
});

// ── PATCH /manage/punches/:id ──────────────────────────────────────────────
// Edit a punch. Records before/after in audit_log.
const editPunchSchema = z.object({
  ts: z.string().datetime().optional(),
  type: z.enum(['clock_in', 'clock_out', 'lunch_start', 'lunch_end']).optional(),
  // location_id: nullable = remote / WFH (mirrors WFH-PIN punches that record
  // location_id=NULL). Manager edit lets Dr. Dawood reassign a punch logged
  // to the wrong office. Send `null` explicitly for remote, omit to leave
  // the location untouched.
  location_id: z.number().int().positive().nullable().optional(),
  flagged: z.boolean().optional(),
  reason: z.string().min(1).max(500),
});

router.patch('/punches/:id', async (req, res) => {
  const id = parseInt(String(req.params.id), 10);
  if (Number.isNaN(id)) {
    res.status(400).json({ error: 'Bad id' });
    return;
  }
  const parsed = editPunchSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Bad request', issues: parsed.error.issues });
    return;
  }
  const patch = parsed.data;

  type Result =
    | { ok: true; punch: any }
    | { ok: false; status: number; error: string };

  const result = await withTransaction<Result>(async (client) => {
    const before = await client.query(
      `SELECT id, user_id, type, ts, location_id, flagged, flag_reason, source FROM timeclock.punches WHERE id = $1 FOR UPDATE`,
      [id],
    );
    if (before.rowCount === 0) {
      return { ok: false, status: 404, error: 'Not found' };
    }
    const updates: string[] = [];
    const params: any[] = [];
    if (patch.ts) {
      params.push(new Date(patch.ts));
      updates.push(`ts = $${params.length}`);
    }
    if (patch.type) {
      params.push(patch.type);
      updates.push(`type = $${params.length}`);
    }
    // `location_id` is in the patch only if the manager touched the picker.
    // `null` is a meaningful value (= remote / WFH), so use a key check
    // rather than truthiness.
    if ('location_id' in patch) {
      params.push(patch.location_id);
      updates.push(`location_id = $${params.length}`);
    }
    if (typeof patch.flagged === 'boolean') {
      params.push(patch.flagged);
      updates.push(`flagged = $${params.length}`);
    }
    if (updates.length === 0) {
      return { ok: false, status: 400, error: 'No changes' };
    }
    params.push(id);
    const updated = await client.query(
      `UPDATE timeclock.punches SET ${updates.join(', ')} WHERE id = $${params.length}
       RETURNING id, user_id, type, ts, location_id, flagged, flag_reason, source`,
      params,
    );
    await client.query(
      `INSERT INTO timeclock.audit_log
         (actor_user_id, resource_type, resource_id, action, before_state, after_state, reason)
       VALUES ($1, 'punch', $2, 'edit', $3, $4, $5)`,
      [
        req.auth!.user_id,
        id,
        JSON.stringify(before.rows[0]),
        JSON.stringify(updated.rows[0]),
        patch.reason,
      ],
    );
    return { ok: true, punch: updated.rows[0] };
  });

  if (!result.ok) {
    res.status(result.status).json({ error: result.error });
    return;
  }
  res.json({ punch: result.punch });
});

// ── DELETE /manage/punches/:id ─────────────────────────────────────────────
// Removes a punch entirely. Records the full before-state in audit_log so
// the row is recoverable from the JSON snapshot.
router.delete('/punches/:id', async (req, res) => {
  const id = parseInt(String(req.params.id), 10);
  if (Number.isNaN(id)) {
    res.status(400).json({ error: 'Bad id' });
    return;
  }
  const reason = (req.body?.reason ?? '') as string;
  if (!reason || reason.trim().length < 3) {
    res.status(400).json({ error: 'A reason is required (min 3 chars)' });
    return;
  }

  type Result =
    | { ok: true }
    | { ok: false; status: number; error: string };
  const result = await withTransaction<Result>(async (client) => {
    const before = await client.query(
      `SELECT * FROM timeclock.punches WHERE id = $1 FOR UPDATE`,
      [id],
    );
    if (before.rowCount === 0) {
      return { ok: false, status: 404, error: 'Not found' };
    }
    await client.query(`DELETE FROM timeclock.punches WHERE id = $1`, [id]);
    await client.query(
      `INSERT INTO timeclock.audit_log
         (actor_user_id, resource_type, resource_id, action, before_state, reason)
       VALUES ($1, 'punch', $2, 'delete', $3, $4)`,
      [req.auth!.user_id, id, JSON.stringify(before.rows[0]), reason],
    );
    return { ok: true };
  });
  if (!result.ok) {
    res.status(result.status).json({ error: result.error });
    return;
  }
  res.json({ ok: true });
});

// ── POST /manage/punches ───────────────────────────────────────────────────
// Insert a missing punch (manager edit).
const insertPunchSchema = z.object({
  user_id: z.number().int().positive(),
  type: z.enum(['clock_in', 'clock_out', 'lunch_start', 'lunch_end']),
  ts: z.string().datetime(),
  location_id: z.number().int().positive().nullable().optional(),
  reason: z.string().min(1).max(500),
});

router.post('/punches', async (req, res) => {
  const parsed = insertPunchSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Bad request', issues: parsed.error.issues });
    return;
  }
  const data = parsed.data;
  const punch = await withTransaction(async (client) => {
    const inserted = await recordPunch({
      userId: data.user_id,
      locationId: data.location_id ?? null,
      type: data.type as PunchType,
      source: 'manager_edit' as PunchSource,
      ts: new Date(data.ts),
      flagged: false,
      client,
    });
    await client.query(
      `INSERT INTO timeclock.audit_log
         (actor_user_id, resource_type, resource_id, action, after_state, reason)
       VALUES ($1, 'punch', $2, 'insert', $3, $4)`,
      [req.auth!.user_id, inserted.id, JSON.stringify(inserted), data.reason],
    );
    return inserted;
  });
  res.status(201).json({ punch });
});

// ── GET /manage/missed ─────────────────────────────────────────────────────
// Returns pending requests + everything decided since AZ midnight today, so
// the manager has visible confirmation of what she just approved/denied
// without navigating to each employee's profile.
router.get('/missed', async (_req, res) => {
  const { rows: pending } = await query(
    `SELECT m.*, u.name AS user_name
     FROM timeclock.missed_punch_requests m
     JOIN timeclock.users u ON u.id = m.user_id
     WHERE m.status = 'pending'
     ORDER BY m.created_at DESC`,
  );
  const { rows: decidedToday } = await query(
    `SELECT m.*, u.name AS user_name, decider.name AS decider_name,
            (SELECT (after_state->>'inserted_punch_id')::int
             FROM timeclock.audit_log a
             WHERE a.resource_type = 'missed_request'
               AND a.resource_id = m.id
               AND a.action = 'approve'
             LIMIT 1) AS inserted_punch_id
     FROM timeclock.missed_punch_requests m
     JOIN timeclock.users u ON u.id = m.user_id
     LEFT JOIN timeclock.users decider ON decider.id = m.decided_by
     WHERE m.status IN ('approved', 'denied')
       AND m.decided_at >= date_trunc('day', NOW() AT TIME ZONE 'America/Phoenix') AT TIME ZONE 'America/Phoenix'
     ORDER BY m.decided_at DESC`,
  );
  res.json({ requests: pending, decided_today: decidedToday });
});

const decideSchema = z.object({
  decision: z.enum(['approve', 'deny']),
  note: z.string().max(500).optional(),
});

router.post('/missed/:id/decide', async (req, res) => {
  const id = parseInt(String(req.params.id), 10);
  const parsed = decideSchema.safeParse(req.body);
  if (Number.isNaN(id) || !parsed.success) {
    res.status(400).json({ error: 'Bad request' });
    return;
  }
  type Result =
    | { ok: true; status: 'approved' | 'denied' }
    | { ok: false; httpStatus: number; error: string };

  const result = await withTransaction<Result>(async (client) => {
    const r = await client.query(
      `SELECT * FROM timeclock.missed_punch_requests WHERE id = $1 AND status = 'pending' FOR UPDATE`,
      [id],
    );
    const reqRow = r.rows[0];
    if (!reqRow) {
      return { ok: false, httpStatus: 404, error: 'Not found' };
    }
    const status = parsed.data.decision === 'approve' ? 'approved' : 'denied';
    await client.query(
      `UPDATE timeclock.missed_punch_requests
       SET status = $1, decided_by = $2, decided_at = NOW()
       WHERE id = $3`,
      [status, req.auth!.user_id, id],
    );
    if (status === 'approved') {
      // Use the location_id captured at request time (kiosk infers it from
      // which PIN was used). If null on a legacy row that predates migration
      // 012, fall back to the user's home_location_id — single-rate users
      // see no rate impact, dual-rate users get the office rate (the common
      // case; pre-migration there were 0 approved missed punches for any
      // dual-rate user, so this fallback path is purely defensive).
      let locationId: number | null = reqRow.location_id ?? null;
      if (reqRow.location_id == null) {
        const homeLocRow = await client.query<{ home_location_id: number | null }>(
          `SELECT home_location_id FROM timeclock.users WHERE id = $1`,
          [reqRow.user_id],
        );
        locationId = homeLocRow.rows[0]?.home_location_id ?? null;
      }
      const inserted = await recordPunch({
        userId: reqRow.user_id,
        locationId,
        type: reqRow.type,
        source: 'manager_edit',
        ts: new Date(reqRow.proposed_ts),
        flagged: false,
        client,
      });
      await client.query(
        `INSERT INTO timeclock.audit_log
           (actor_user_id, resource_type, resource_id, action, after_state, reason)
         VALUES ($1, 'missed_request', $2, 'approve', $3, $4)`,
        [
          req.auth!.user_id,
          id,
          JSON.stringify({ inserted_punch_id: inserted.id }),
          parsed.data.note ?? `Approved missed ${reqRow.type}`,
        ],
      );
    } else {
      await client.query(
        `INSERT INTO timeclock.audit_log
           (actor_user_id, resource_type, resource_id, action, reason)
         VALUES ($1, 'missed_request', $2, 'deny', $3)`,
        [req.auth!.user_id, id, parsed.data.note ?? 'Denied'],
      );
    }
    return { ok: true, status };
  });

  if (!result.ok) {
    res.status(result.httpStatus).json({ error: result.error });
    return;
  }
  res.json({ ok: true, status: result.status });
});

// ── GET /manage/lunch-reviews ──────────────────────────────────────────────
// Queue of clock_out punches that landed in the lunch-review queue
// (no_lunch or short_lunch on a 7+ hour shift). Default returns pending;
// ?status=all returns the last 30 days across all statuses so Dr. Dawood
// can audit her own decisions.
router.get('/lunch-reviews', async (req, res) => {
  const status = String(req.query.status ?? 'pending');

  // Non-owner managers see only their home location's queue. Owners (Dr.
  // Dawood) see all 3 offices. Filter joins through the punch's user's
  // home_location_id (payroll rolls to home regardless of where the punch
  // happened, same rule applied here for the review queue).
  const params: any[] = [];
  let locationClause = '';
  if (!req.auth!.is_owner) {
    const { rows: meRows } = await query<{ home_location_id: number | null }>(
      `SELECT home_location_id FROM timeclock.users WHERE id = $1`,
      [req.auth!.user_id],
    );
    const homeLoc = meRows[0]?.home_location_id ?? null;
    if (homeLoc !== null) {
      params.push(homeLoc);
      locationClause = ` AND u.home_location_id = $${params.length}`;
    } else {
      // Manager with no home location — return empty queue rather than leaking
      // every office's data.
      res.json({ pending: [], decided: [] });
      return;
    }
  }

  const baseSelect = `
    SELECT p.id, p.user_id, u.name AS user_name, p.ts, p.location_id,
           p.no_lunch_reason, p.lunch_review_status, p.lunch_review_reason,
           p.lunch_review_minutes, p.lunch_reviewed_by, p.lunch_reviewed_at,
           p.lunch_review_notes, decider.name AS reviewed_by_name
    FROM timeclock.punches p
    JOIN timeclock.users u ON u.id = p.user_id
    LEFT JOIN timeclock.users decider ON decider.id = p.lunch_reviewed_by
  `;

  const pendingRows = await query(
    `${baseSelect}
     WHERE p.lunch_review_status = 'pending'${locationClause}
     ORDER BY p.ts DESC
     LIMIT 200`,
    params,
  );

  let decided: any[] = [];
  if (status === 'all') {
    const r = await query(
      `${baseSelect}
       WHERE p.lunch_review_status IN ('approved', 'rejected')
         AND p.lunch_reviewed_at >= NOW() - INTERVAL '30 days'${locationClause}
       ORDER BY p.lunch_reviewed_at DESC
       LIMIT 100`,
      params,
    );
    decided = r.rows;
  }

  res.json({ pending: pendingRows.rows, decided });
});

// ── POST /manage/lunch-reviews/:punchId ────────────────────────────────────
// Dr. Dawood approves or rejects a flagged shift. Notes are optional.
// Once decided, the row drops out of the pending queue but stays queryable
// via ?status=all for the audit trail.
const lunchReviewSchema = z.object({
  decision: z.enum(['approve', 'reject']),
  notes: z.string().max(1000).optional(),
});

router.post('/lunch-reviews/:punchId', async (req, res) => {
  const punchId = parseInt(String(req.params.punchId), 10);
  const parsed = lunchReviewSchema.safeParse(req.body);
  if (Number.isNaN(punchId) || !parsed.success) {
    res.status(400).json({ error: 'Bad request' });
    return;
  }
  const newStatus = parsed.data.decision === 'approve' ? 'approved' : 'rejected';

  type Result =
    | { ok: true; status: 'approved' | 'rejected' }
    | { ok: false; httpStatus: number; error: string };

  const result = await withTransaction<Result>(async (client) => {
    const r = await client.query<{
      id: number;
      lunch_review_status: string | null;
    }>(
      `SELECT id, lunch_review_status
       FROM timeclock.punches
       WHERE id = $1
       FOR UPDATE`,
      [punchId],
    );
    if (r.rows.length === 0) {
      return { ok: false, httpStatus: 404, error: 'Not found' };
    }
    if (r.rows[0].lunch_review_status !== 'pending') {
      return { ok: false, httpStatus: 409, error: 'Not pending' };
    }
    await client.query(
      `UPDATE timeclock.punches
       SET lunch_review_status = $1,
           lunch_reviewed_by = $2,
           lunch_reviewed_at = NOW(),
           lunch_review_notes = $3
       WHERE id = $4`,
      [newStatus, req.auth!.user_id, parsed.data.notes ?? null, punchId],
    );
    await client.query(
      `INSERT INTO timeclock.audit_log
         (actor_user_id, resource_type, resource_id, action, before_state, after_state, reason)
       VALUES ($1, 'punch', $2, $3, $4, $5, $6)`,
      [
        req.auth!.user_id,
        punchId,
        newStatus === 'approved' ? 'lunch_review_approve' : 'lunch_review_reject',
        JSON.stringify({ lunch_review_status: 'pending' }),
        JSON.stringify({
          lunch_review_status: newStatus,
          lunch_reviewed_by: req.auth!.user_id,
          lunch_review_notes: parsed.data.notes ?? null,
        }),
        parsed.data.notes ?? `${newStatus} lunch review`,
      ],
    );
    return { ok: true, status: newStatus };
  });

  if (!result.ok) {
    res.status(result.httpStatus).json({ error: result.error });
    return;
  }
  res.json({ ok: true, status: result.status });
});

// ── GET /manage/staff (manager+) ───────────────────────────────────────────
// Owners get full rows. Non-owner managers (e.g. a front-office manager who
// keeps staff CPR certs current) get the same roster with pay rates stripped
// server-side — pay is owner-only and must never leave the server for a
// non-owner, regardless of what the client chooses to render.
router.get('/staff', requireManager, async (req, res) => {
  const { rows } = await query(
    `SELECT id, name, email, role, employment_type, pay_rate_cents, pay_rate_cents_remote,
            is_owner, is_manager, track_hours, active, last_login_at, created_at,
            cpr_org, cpr_issued_at, cpr_expires_at, cpr_updated_at
     FROM timeclock.users
     ORDER BY active DESC, name ASC`,
  );
  const staff = req.auth?.is_owner
    ? rows
    : rows.map((r: any) => ({
        ...r,
        pay_rate_cents: null,
        pay_rate_cents_remote: null,
      }));
  res.json({ staff });
});

// ── GET /manage/employees ──────────────────────────────────────────────────
// Minimal employee picker (manager or owner). No pay rate, no email — just
// enough to populate dropdowns like AddHoursModal. /staff is owner-only
// because it leaks pay rates; this endpoint is the manager-safe version.
//
// home_location_id + has_remote_rate are exposed so AddHoursModal can default
// the location picker to the employee's home office and show a "WFH /
// remote" option only for dual-rate staff (preventing accidental rate-bucket
// mis-assignment when adding missing punches). has_remote_rate is a boolean
// flag — the actual rate value stays owner-only.
router.get('/employees', async (_req, res) => {
  const { rows } = await query(
    `SELECT id, name, role, is_owner, is_manager, track_hours, active,
            home_location_id,
            (pay_rate_cents_remote IS NOT NULL) AS has_remote_rate
     FROM timeclock.users
     WHERE active = true AND track_hours = true AND is_owner = false
     ORDER BY name ASC`,
  );
  res.json({ employees: rows });
});

const createStaffSchema = z.object({
  name: z.string().min(2).max(120),
  email: z.string().email().optional(),
  role: z.string().min(1).max(40),
  employment_type: z.enum(['W2', '1099']),
  pin: z.string().regex(/^\d{4}$/),
  pay_rate_cents: z.number().int().nonnegative().nullable().optional(),
  is_manager: z.boolean().optional(),
  track_hours: z.boolean().optional(),
});

router.post('/staff', requireOwner, async (req, res) => {
  const parsed = createStaffSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Bad request', issues: parsed.error.issues });
    return;
  }
  const d = parsed.data;
  const pinHash = await hashPin(d.pin);

  // PIN collision guard — check against every existing PIN (primary + remote).
  const { rows: actives } = await query<{
    id: number;
    pin_hash: string | null;
    pin_hash_remote: string | null;
  }>(
    `SELECT id, pin_hash, pin_hash_remote FROM timeclock.users WHERE active = true`,
  );
  for (const u of actives) {
    if (u.pin_hash && (await bcrypt.compare(d.pin, u.pin_hash))) {
      res.status(409).json({ error: 'PIN already in use — pick a different one.' });
      return;
    }
    if (u.pin_hash_remote && (await bcrypt.compare(d.pin, u.pin_hash_remote))) {
      res.status(409).json({ error: 'PIN already in use — pick a different one.' });
      return;
    }
  }

  const { rows } = await query(
    `INSERT INTO timeclock.users
       (name, email, pin_hash, role, employment_type, pay_rate_cents,
        is_manager, track_hours)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING id, name, email, role, employment_type, is_manager, track_hours, active`,
    [
      d.name,
      d.email ?? null,
      pinHash,
      d.role,
      d.employment_type,
      d.pay_rate_cents ?? null,
      d.is_manager ?? false,
      d.track_hours ?? true,
    ],
  );
  await query(
    `INSERT INTO timeclock.audit_log
       (actor_user_id, resource_type, resource_id, action, after_state, reason)
     VALUES ($1, 'user', $2, 'create', $3, 'Staff added')`,
    [req.auth!.user_id, rows[0].id, JSON.stringify(rows[0])],
  );
  res.status(201).json({ user: rows[0] });
});

const patchStaffSchema = z.object({
  name: z.string().min(2).max(120).optional(),
  email: z.string().email().nullable().optional(),
  role: z.string().min(1).max(40).optional(),
  employment_type: z.enum(['W2', '1099']).optional(),
  pin: z.string().regex(/^\d{4}$/).optional(),
  pay_rate_cents: z.number().int().nonnegative().nullable().optional(),
  // Separate WFH rate (used when employee punches with the WFH PIN that
  // bypasses geofence). null = no separate rate, falls back to office rate.
  pay_rate_cents_remote: z.number().int().nonnegative().nullable().optional(),
  is_manager: z.boolean().optional(),
  track_hours: z.boolean().optional(),
  active: z.boolean().optional(),
  // CPR cert — atomic group. Send org+issued+expires together (all three
  // strings) to set, or all three explicitly null to clear. Mirrors
  // /kiosk/cpr's invariant so the manager can't accidentally land a
  // half-written cert record. Date strings are YYYY-MM-DD.
  cpr_org: z.string().trim().min(1).max(120).nullable().optional(),
  cpr_issued_at: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  cpr_expires_at: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  reason: z.string().min(1).max(500),
});

router.patch('/staff/:id', requireManager, async (req, res) => {
  const id = parseInt(String(req.params.id), 10);
  if (Number.isNaN(id)) {
    res.status(400).json({ error: 'Bad id' });
    return;
  }
  const parsed = patchStaffSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Bad request', issues: parsed.error.issues });
    return;
  }
  const d = parsed.data;

  // Non-owner managers may edit CPR certification ONLY. Pay, role, PIN,
  // employment type, manager/active status, name and email are owner-only.
  // Enforced here at the boundary — the client also hides these controls for
  // non-owners, but this is the line that actually protects payroll.
  if (!req.auth?.is_owner) {
    const ownerOnlyTouched =
      d.name !== undefined ||
      d.email !== undefined ||
      d.role !== undefined ||
      d.employment_type !== undefined ||
      d.pin !== undefined ||
      d.pay_rate_cents !== undefined ||
      d.pay_rate_cents_remote !== undefined ||
      d.is_manager !== undefined ||
      d.track_hours !== undefined ||
      d.active !== undefined;
    if (ownerOnlyTouched) {
      res.status(403).json({
        error:
          'Managers can only update CPR certification. Pay, role, and access changes are owner-only.',
      });
      return;
    }
  }
  const updates: string[] = [];
  const params: any[] = [];
  function add(field: string, value: any) {
    params.push(value);
    updates.push(`${field} = $${params.length}`);
  }
  if (d.name !== undefined) add('name', d.name);
  if (d.email !== undefined) add('email', d.email);
  if (d.role !== undefined) add('role', d.role);
  if (d.employment_type !== undefined) add('employment_type', d.employment_type);
  if (d.pay_rate_cents !== undefined) add('pay_rate_cents', d.pay_rate_cents);
  if (d.pay_rate_cents_remote !== undefined) add('pay_rate_cents_remote', d.pay_rate_cents_remote);
  if (d.is_manager !== undefined) add('is_manager', d.is_manager);
  if (d.track_hours !== undefined) add('track_hours', d.track_hours);
  if (d.active !== undefined) add('active', d.active);
  if (d.pin) add('pin_hash', await hashPin(d.pin));

  // CPR cert is atomic — accept all three (set) or all three null (clear).
  // Anything else is a 400 to prevent a half-written record landing in the
  // audit log.
  const cprTouched =
    d.cpr_org !== undefined ||
    d.cpr_issued_at !== undefined ||
    d.cpr_expires_at !== undefined;
  if (cprTouched) {
    if (
      d.cpr_org === undefined ||
      d.cpr_issued_at === undefined ||
      d.cpr_expires_at === undefined
    ) {
      res.status(400).json({
        error:
          'CPR fields are atomic — send cpr_org, cpr_issued_at, cpr_expires_at together.',
      });
      return;
    }
    const allNull =
      d.cpr_org === null && d.cpr_issued_at === null && d.cpr_expires_at === null;
    const allSet =
      d.cpr_org !== null && d.cpr_issued_at !== null && d.cpr_expires_at !== null;
    if (!allNull && !allSet) {
      res.status(400).json({
        error: 'CPR fields must all be set or all cleared (mixed null is rejected).',
      });
      return;
    }
    if (allSet && d.cpr_issued_at! >= d.cpr_expires_at!) {
      res.status(400).json({
        error: 'CPR expiry must be after the issued date.',
      });
      return;
    }
    add('cpr_org', d.cpr_org);
    add('cpr_issued_at', d.cpr_issued_at);
    add('cpr_expires_at', d.cpr_expires_at);
    add('cpr_updated_at', allNull ? null : new Date());
  }

  if (updates.length === 0) {
    res.status(400).json({ error: 'No changes' });
    return;
  }
  params.push(id);
  type Result =
    | { ok: true; user: any }
    | { ok: false; status: number; error: string };
  const result = await withTransaction<Result>(async (client) => {
    const before = await client.query(`SELECT * FROM timeclock.users WHERE id = $1 FOR UPDATE`, [id]);
    if (before.rowCount === 0) {
      return { ok: false, status: 404, error: 'Not found' };
    }
    const updated = await client.query(
      `UPDATE timeclock.users SET ${updates.join(', ')}, updated_at = NOW()
       WHERE id = $${params.length}
       RETURNING id, name, email, role, employment_type, is_manager, track_hours, active,
                cpr_org, cpr_issued_at, cpr_expires_at, cpr_updated_at`,
      params,
    );
    await client.query(
      `INSERT INTO timeclock.audit_log
         (actor_user_id, resource_type, resource_id, action, before_state, after_state, reason)
       VALUES ($1, 'user', $2, 'edit', $3, $4, $5)`,
      [
        req.auth!.user_id,
        id,
        JSON.stringify(redactUser(before.rows[0])),
        JSON.stringify(updated.rows[0]),
        d.reason,
      ],
    );
    return { ok: true, user: updated.rows[0] };
  });
  if (!result.ok) {
    res.status(result.status).json({ error: result.error });
    return;
  }
  res.json({ user: result.user });
});

function redactUser(row: any) {
  // Strip every credential-shaped field. pin_hash_remote was added 2026-04-29
  // and is the bcrypt hash of Filza's WFH PIN — it must not land in the
  // audit log (caught 2026-05-04 during bug hunt).
  const { pin_hash, pin_hash_remote, password_hash, ...rest } = row;
  return rest;
}

// ── GET /manage/locations ──────────────────────────────────────────────────
router.get('/locations', async (_req, res) => {
  const { rows } = await query(
    `SELECT id, slug, name, address, lat, lng, geofence_m, active
     FROM timeclock.locations
     ORDER BY name`,
  );
  res.json({ locations: rows });
});

// ── GET /manage/locations/:id ──────────────────────────────────────────────
// Office detail: location info + roster of staff whose home_location_id
// is this office, with each roster row showing recent activity (last punch
// + minutes worked in current pay period).
router.get('/locations/:id', async (req, res) => {
  const id = parseInt(String(req.params.id), 10);
  if (Number.isNaN(id)) {
    res.status(400).json({ error: 'Bad id' });
    return;
  }
  const { rows: locations } = await query(
    `SELECT id, slug, name, address, lat, lng, geofence_m, active
     FROM timeclock.locations WHERE id = $1`,
    [id],
  );
  if (locations.length === 0) {
    res.status(404).json({ error: 'Not found' });
    return;
  }

  // This location's own pay schedule (Gilbert biweekly vs. Mesa/Glendale
  // semi-monthly). Roster shows minutes for THIS location's current period.
  const period = await periodForLocation(id, new Date());

  const { rows: roster } = await query<{
    id: number;
    name: string;
    role: string;
    employment_type: string;
    pay_rate_cents: number | null;
    is_owner: boolean;
    is_manager: boolean;
    track_hours: boolean;
    active: boolean;
    last_punch_ts: Date | null;
    last_punch_type: string | null;
  }>(
    `SELECT u.id, u.name, u.role, u.employment_type, u.pay_rate_cents,
            u.is_owner, u.is_manager, u.track_hours, u.active,
            (SELECT p.ts FROM timeclock.punches p
             WHERE p.user_id = u.id ORDER BY p.ts DESC LIMIT 1) AS last_punch_ts,
            (SELECT p.type FROM timeclock.punches p
             WHERE p.user_id = u.id ORDER BY p.ts DESC LIMIT 1) AS last_punch_type
     FROM timeclock.users u
     WHERE u.home_location_id = $1 AND u.active = true
     ORDER BY u.name`,
    [id],
  );

  const { rows: punches } = await query<any>(
    `SELECT id, user_id, type, ts, location_id, flagged, auto_closed_at
     FROM timeclock.punches
     WHERE user_id = ANY($1::int[]) AND ts >= $2 AND ts < $3
     ORDER BY ts ASC`,
    [roster.map((r) => r.id), period.start, period.end],
  );

  // Same open-shift cap rule as /period and /employees/:id — if the period
  // is current and a user is on the clock, count their open shift up to
  // NOW, not all the way to period.end.
  const locationOpenCap = new Date(Math.min(period.end.getTime(), Date.now()));
  const rosterWithTotals = roster.map((u) => {
    const userPunches = punches.filter((p) => p.user_id === u.id);
    const segs = buildSegments(userPunches, locationOpenCap);
    const minutes = totalMinutes(segs);
    return {
      ...u,
      period_minutes: minutes,
      open_segments: segs.filter((s) => s.open).length,
    };
  });

  res.json({
    location: locations[0],
    period,
    roster: rosterWithTotals,
  });
});

// ── PATCH /manage/locations/:id (owner) ────────────────────────────────────
const patchLocationSchema = z.object({
  name: z.string().min(2).max(120).optional(),
  address: z.string().max(500).nullable().optional(),
  lat: z.number().min(-90).max(90).optional(),
  lng: z.number().min(-180).max(180).optional(),
  geofence_m: z.number().int().min(20).max(5000).optional(),
  active: z.boolean().optional(),
  reason: z.string().min(1).max(500),
});

router.patch('/locations/:id', requireOwner, async (req, res) => {
  const id = parseInt(String(req.params.id), 10);
  if (Number.isNaN(id)) {
    res.status(400).json({ error: 'Bad id' });
    return;
  }
  const parsed = patchLocationSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Bad request', issues: parsed.error.issues });
    return;
  }
  const d = parsed.data;
  const updates: string[] = [];
  const params: any[] = [];
  function add(field: string, value: any) {
    params.push(value);
    updates.push(`${field} = $${params.length}`);
  }
  if (d.name !== undefined) add('name', d.name);
  if (d.address !== undefined) add('address', d.address);
  if (d.lat !== undefined) add('lat', d.lat);
  if (d.lng !== undefined) add('lng', d.lng);
  if (d.geofence_m !== undefined) add('geofence_m', d.geofence_m);
  if (d.active !== undefined) add('active', d.active);
  if (updates.length === 0) {
    res.status(400).json({ error: 'No changes' });
    return;
  }
  params.push(id);

  type Result =
    | { ok: true; location: any }
    | { ok: false; status: number; error: string };
  const result = await withTransaction<Result>(async (client) => {
    const before = await client.query(
      `SELECT * FROM timeclock.locations WHERE id = $1 FOR UPDATE`,
      [id],
    );
    if (before.rowCount === 0) {
      return { ok: false, status: 404, error: 'Not found' };
    }
    const updated = await client.query(
      `UPDATE timeclock.locations SET ${updates.join(', ')}, updated_at = NOW()
       WHERE id = $${params.length}
       RETURNING id, slug, name, address, lat, lng, geofence_m, active`,
      params,
    );
    await client.query(
      `INSERT INTO timeclock.audit_log
         (actor_user_id, resource_type, resource_id, action, before_state, after_state, reason)
       VALUES ($1, 'location', $2, 'edit', $3, $4, $5)`,
      [
        req.auth!.user_id,
        id,
        JSON.stringify(before.rows[0]),
        JSON.stringify(updated.rows[0]),
        d.reason,
      ],
    );
    return { ok: true, location: updated.rows[0] };
  });
  if (!result.ok) {
    res.status(result.status).json({ error: result.error });
    return;
  }
  res.json({ location: result.location });
});

// ── POST /manage/auto-close (owner) — manually trigger ────────────────────
router.post('/auto-close', requireOwner, async (_req, res) => {
  const { closed } = await runAutoClose();
  res.json({ closed });
});

// ── GET /manage/audit (owner) ──────────────────────────────────────────────
// Paginated audit log. Optional ?resource_type=punch|user|location|missed_request
// and ?limit=50 (max 200).
router.get('/audit', requireOwner, async (req, res) => {
  const resourceType = req.query.resource_type as string | undefined;
  const limitParsed = parseInt(String(req.query.limit ?? '50'), 10);
  const limit = Math.max(1, Math.min(Number.isFinite(limitParsed) && limitParsed > 0 ? limitParsed : 50, 200));
  const before = req.query.before
    ? new Date(String(req.query.before))
    : null;

  const params: any[] = [];
  const where: string[] = [];
  if (resourceType) {
    params.push(resourceType);
    where.push(`a.resource_type = $${params.length}`);
  }
  if (before && !Number.isNaN(before.getTime())) {
    params.push(before);
    where.push(`a.ts < $${params.length}`);
  }
  params.push(limit);

  const { rows } = await query(
    `SELECT a.id, a.actor_user_id, u.name AS actor_name,
            a.resource_type, a.resource_id, a.action,
            a.before_state, a.after_state, a.reason, a.ts,
            a.ip::text AS ip
     FROM timeclock.audit_log a
     LEFT JOIN timeclock.users u ON u.id = a.actor_user_id
     ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
     ORDER BY a.ts DESC
     LIMIT $${params.length}`,
    params,
  );
  // Defense-in-depth credential scrub on the way out. Historical rows from
  // before redactUser was hardened (2026-05-04) contain pin_hash and
  // pin_hash_remote bcrypts on user 'edit' / 'revoke_wfh_pin' /
  // 'restore_wfh_pin' actions. Bcrypt of a 4-digit PIN is brute-forceable in
  // seconds, so these must never reach a browser. We strip the keys here at
  // serialization time so the historical leak doesn't egress via the audit
  // panel even if the row hasn't been DB-scrubbed yet.
  const scrubbed = rows.map((r: any) => ({
    ...r,
    before_state: scrubCredentials(r.before_state),
    after_state: scrubCredentials(r.after_state),
  }));
  res.json({ entries: scrubbed });
});

function scrubCredentials(state: unknown): unknown {
  if (state == null || typeof state !== 'object' || Array.isArray(state)) {
    return state;
  }
  const { pin_hash, pin_hash_remote, password_hash, ...rest } = state as Record<string, unknown>;
  return rest;
}

export default router;
