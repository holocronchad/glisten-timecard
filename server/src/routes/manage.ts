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
import { payrollForPeriod, rowsToCsv } from '../services/payroll';
import { periodForDate, periodByIndex } from '../services/payPeriod';
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

  const result = await findUserByPin(pin);
  if (!result.ok) {
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
    res.status(403).json({ error: 'Not a manager' });
    return;
  }
  await query(`UPDATE timeclock.users SET last_login_at = NOW() WHERE id = $1`, [user.id]);
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

// ── GET /manage/today ──────────────────────────────────────────────────────
// Per-employee status today. Active staff only.
router.get('/today', async (_req, res) => {
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
        ? { id: last.id, type: last.type, ts: last.ts, flagged: last.flagged }
        : null,
    };
  });

  res.json({
    today,
    employees: out,
    pending_count: users.filter((u) => !u.approved).length,
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
router.get('/period', async (req, res) => {
  const idxRaw = req.query.index as string | undefined;
  const period =
    idxRaw !== undefined
      ? periodByIndex(parseInt(idxRaw, 10))
      : periodForDate(new Date());

  const { rows: users } = await query<{
    id: number;
    name: string;
    employment_type: string;
  }>(
    `SELECT id, name, employment_type
     FROM timeclock.users
     WHERE active = true AND track_hours = true
     ORDER BY name`,
  );
  const { rows: punches } = await query<any>(
    `SELECT id, user_id, type, ts, flagged, auto_closed_at
     FROM timeclock.punches
     WHERE ts >= $1 AND ts < $2
     ORDER BY ts ASC`,
    [period.start, period.end],
  );

  const employees = users.map((u) => {
    const segs = buildSegments(
      punches.filter((p) => p.user_id === u.id),
      period.end,
    );
    const totals = totalsByDay(segs);
    const minutes = totalMinutes(segs);
    return {
      user: u,
      total_minutes: minutes,
      daily_totals: totals,
      flagged_count: punches.filter((p) => p.user_id === u.id && p.flagged).length,
      open_segments: segs.filter((s) => s.open).length,
    };
  });

  res.json({ period, employees });
});

// ── GET /manage/payroll.csv ────────────────────────────────────────────────
router.get('/payroll.csv', requireOwner, async (req, res) => {
  const idxRaw = req.query.index as string | undefined;
  const period =
    idxRaw !== undefined
      ? periodByIndex(parseInt(idxRaw, 10))
      : periodForDate(new Date());
  const rows = await payrollForPeriod(period.start, period.end);
  const csv = rowsToCsv(rows, period.label);
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="glisten-payroll-${period.start.toISOString().slice(0, 10)}.csv"`,
  );
  res.send(csv);
});

// ── GET /manage/punches ────────────────────────────────────────────────────
// Filterable punch log: ?user_id, ?from, ?to, ?flagged
router.get('/punches', async (req, res) => {
  const userId = req.query.user_id ? parseInt(String(req.query.user_id), 10) : null;
  const from = req.query.from ? new Date(String(req.query.from)) : null;
  const to = req.query.to ? new Date(String(req.query.to)) : null;
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
            p.type, p.ts, p.source, p.flagged, p.flag_reason, p.geofence_pass, p.auto_closed_at
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
// optional date range (defaults to current pay period).
router.get('/employees/:id', async (req, res) => {
  const id = parseInt(String(req.params.id), 10);
  if (Number.isNaN(id)) {
    res.status(400).json({ error: 'Bad id' });
    return;
  }
  const idxRaw = req.query.index as string | undefined;
  const period =
    idxRaw !== undefined
      ? periodByIndex(parseInt(idxRaw, 10))
      : periodForDate(new Date());

  const { rows: users } = await query(
    `SELECT id, name, email, role, employment_type, pay_rate_cents,
            is_owner, is_manager, track_hours, active
     FROM timeclock.users WHERE id = $1`,
    [id],
  );
  if (users.length === 0) {
    res.status(404).json({ error: 'Not found' });
    return;
  }

  const { rows: punches } = await query(
    `SELECT p.id, p.location_id, l.name AS location_name, p.type, p.ts,
            p.source, p.flagged, p.flag_reason, p.geofence_pass, p.auto_closed_at
     FROM timeclock.punches p
     LEFT JOIN timeclock.locations l ON l.id = p.location_id
     WHERE p.user_id = $1 AND p.ts >= $2 AND p.ts < $3
     ORDER BY p.ts ASC`,
    [id, period.start, period.end],
  );

  const { rows: missed } = await query(
    `SELECT id, type, proposed_ts, reason, status, created_at, decided_at
     FROM timeclock.missed_punch_requests
     WHERE user_id = $1
     ORDER BY created_at DESC
     LIMIT 30`,
    [id],
  );

  res.json({
    user: users[0],
    period,
    punches,
    missed,
  });
});

// ── PATCH /manage/punches/:id ──────────────────────────────────────────────
// Edit a punch. Records before/after in audit_log.
const editPunchSchema = z.object({
  ts: z.string().datetime().optional(),
  type: z.enum(['clock_in', 'clock_out', 'lunch_start', 'lunch_end']).optional(),
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
      `SELECT id, user_id, type, ts, flagged, flag_reason, source FROM timeclock.punches WHERE id = $1 FOR UPDATE`,
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
       RETURNING id, user_id, type, ts, flagged, flag_reason, source`,
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
router.get('/missed', async (_req, res) => {
  const { rows } = await query(
    `SELECT m.*, u.name AS user_name
     FROM timeclock.missed_punch_requests m
     JOIN timeclock.users u ON u.id = m.user_id
     WHERE m.status = 'pending'
     ORDER BY m.created_at DESC`,
  );
  res.json({ requests: rows });
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
      const inserted = await recordPunch({
        userId: reqRow.user_id,
        locationId: null,
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

// ── GET /manage/staff (owner) ──────────────────────────────────────────────
router.get('/staff', requireOwner, async (_req, res) => {
  const { rows } = await query(
    `SELECT id, name, email, role, employment_type, pay_rate_cents,
            is_owner, is_manager, track_hours, active, last_login_at, created_at
     FROM timeclock.users
     ORDER BY active DESC, name ASC`,
  );
  res.json({ staff: rows });
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
  is_manager: z.boolean().optional(),
  track_hours: z.boolean().optional(),
  active: z.boolean().optional(),
  reason: z.string().min(1).max(500),
});

router.patch('/staff/:id', requireOwner, async (req, res) => {
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
  if (d.is_manager !== undefined) add('is_manager', d.is_manager);
  if (d.track_hours !== undefined) add('track_hours', d.track_hours);
  if (d.active !== undefined) add('active', d.active);
  if (d.pin) add('pin_hash', await hashPin(d.pin));
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
       RETURNING id, name, email, role, employment_type, is_manager, track_hours, active`,
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
  const { pin_hash, password_hash, ...rest } = row;
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
  const limit = Math.min(
    parseInt(String(req.query.limit ?? '50'), 10) || 50,
    200,
  );
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
            a.before_state, a.after_state, a.reason, a.ts
     FROM timeclock.audit_log a
     LEFT JOIN timeclock.users u ON u.id = a.actor_user_id
     ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
     ORDER BY a.ts DESC
     LIMIT $${params.length}`,
    params,
  );
  res.json({ entries: rows });
});

export default router;
