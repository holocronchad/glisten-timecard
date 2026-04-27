// Kiosk endpoints — used by the kiosk UI on iPads + desktops + personal phones.
// PIN-only auth, no persistent session: every action submits PIN + lat/lng.

import { Router } from 'express';
import { z } from 'zod';
import { findUserByPin } from '../auth/pin';
import { matchLocation } from '../services/geofence';
import {
  getLatestPunch, nextAllowedPunches, recordPunch, type PunchType,
} from '../services/punches';
import { query } from '../db';

const router = Router();

// ── POST /kiosk/lookup ─────────────────────────────────────────────────────
// Body: { pin: '1234', lat?: number, lng?: number }
// Returns: { user: {id,name,track_hours}, allowedActions: [...], lastPunch, location }
const lookupSchema = z.object({
  pin: z.string().regex(/^\d{4}$/),
  lat: z.number().min(-90).max(90).optional(),
  lng: z.number().min(-180).max(180).optional(),
});

router.post('/lookup', async (req, res) => {
  const parsed = lookupSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Bad request' });
    return;
  }

  const { pin, lat, lng } = parsed.data;
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
  if (!user.track_hours) {
    res.status(403).json({ error: 'This account does not punch the clock' });
    return;
  }

  // Geofence check (best-effort — informational, not blocking the lookup)
  let inOffice: { id: number; distance_m: number } | null = null;
  if (typeof lat === 'number' && typeof lng === 'number') {
    const { rows: locations } = await query(
      `SELECT id, lat, lng, geofence_m, active FROM timeclock.locations WHERE active = true`
    );
    inOffice = matchLocation({ lat, lng }, locations as any);
  }

  const latest = await getLatestPunch(user.id);
  const allowed = nextAllowedPunches(latest);

  res.json({
    user: { id: user.id, name: user.name },
    last_punch: latest ? {
      type: latest.type,
      ts: latest.ts,
      location_id: latest.location_id,
      flagged: latest.flagged,
    } : null,
    allowed_actions: allowed,
    location: inOffice,
    geofence_required: true,
  });
});

// ── POST /kiosk/punch ──────────────────────────────────────────────────────
// Body: { pin, type: 'clock_in'|..., lat, lng }
// Returns: { punch: {id,type,ts}, message }
const punchSchema = z.object({
  pin: z.string().regex(/^\d{4}$/),
  type: z.enum(['clock_in', 'clock_out', 'lunch_start', 'lunch_end']),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
});

router.post('/punch', async (req, res) => {
  const parsed = punchSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Bad request', issues: parsed.error.issues });
    return;
  }

  const { pin, type, lat, lng } = parsed.data;
  const result = await findUserByPin(pin);
  if (!result.ok) {
    res.status(401).json({ error: result.reason === 'locked' ? 'Locked' : 'Invalid PIN' });
    return;
  }
  const user = result.user;
  if (!user.track_hours) {
    res.status(403).json({ error: 'This account does not punch the clock' });
    return;
  }

  // Geofence — required for actual punch (lookup was informational)
  const { rows: locations } = await query(
    `SELECT id, lat, lng, geofence_m, active FROM timeclock.locations WHERE active = true`
  );
  const office = matchLocation({ lat, lng }, locations as any);
  if (!office) {
    res.status(403).json({
      error: 'Outside office',
      message: 'You can only punch when you are at a Glisten Dental office.',
    });
    return;
  }

  // Validate the requested transition
  const latest = await getLatestPunch(user.id);
  const allowed = nextAllowedPunches(latest);
  if (!allowed.includes(type as PunchType)) {
    res.status(409).json({
      error: 'Not allowed',
      message: `You can't ${type.replace('_', ' ')} right now.`,
      last: latest?.type ?? null,
      allowed,
    });
    return;
  }

  const ip =
    (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ||
    req.ip ||
    null;

  const punch = await recordPunch({
    userId: user.id,
    locationId: office.id,
    type: type as PunchType,
    source: 'kiosk',
    ip,
    lat,
    lng,
    geofencePass: true,
  });

  res.json({
    punch: { id: punch.id, type: punch.type, ts: punch.ts },
    message: messageFor(type as PunchType, user.name),
    location_id: office.id,
  });
});

function messageFor(type: PunchType, name: string): string {
  const first = name.split(' ')[0];
  switch (type) {
    case 'clock_in':    return `Welcome in, ${first}.`;
    case 'clock_out':   return `Have a great rest of your day, ${first}.`;
    case 'lunch_start': return `Enjoy your lunch, ${first}.`;
    case 'lunch_end':   return `Welcome back, ${first}.`;
  }
}

// ── POST /kiosk/missed-punch ───────────────────────────────────────────────
// Employee submits "I forgot to clock in/out at <time>" — manager approves
// or denies in /manage/missed. PIN-only, no geofence required.
const missedSchema = z.object({
  pin: z.string().regex(/^\d{4}$/),
  type: z.enum(['clock_in', 'clock_out', 'lunch_start', 'lunch_end']),
  proposed_ts: z.string().datetime(),
  reason: z.string().min(3).max(500),
});

router.post('/missed-punch', async (req, res) => {
  const parsed = missedSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Bad request', issues: parsed.error.issues });
    return;
  }
  const { pin, type, proposed_ts, reason } = parsed.data;
  const result = await findUserByPin(pin);
  if (!result.ok) {
    res.status(401).json({ error: result.reason === 'locked' ? 'Locked' : 'Invalid PIN' });
    return;
  }
  if (!result.user.track_hours) {
    res.status(403).json({ error: 'This account does not punch the clock' });
    return;
  }

  const ts = new Date(proposed_ts);
  const now = new Date();
  if (ts > now) {
    res.status(400).json({ error: 'Proposed time cannot be in the future' });
    return;
  }
  if (now.getTime() - ts.getTime() > 14 * 24 * 60 * 60_000) {
    res.status(400).json({ error: 'Cannot request punches older than 14 days' });
    return;
  }

  const date = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Phoenix',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(ts);

  const { rows } = await query(
    `INSERT INTO timeclock.missed_punch_requests
       (user_id, date, type, proposed_ts, reason)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id, status, created_at`,
    [result.user.id, date, type, ts, reason],
  );

  res.status(201).json({
    request: rows[0],
    message: `Request sent. A manager will review it shortly.`,
  });
});

// ── GET /kiosk/me ──────────────────────────────────────────────────────────
// PIN in query for read-only "view my hours" — no state change, no geofence.
// Used by the personal-view screen.
router.get('/me', async (req, res) => {
  const pin = String(req.query.pin || '');
  if (!/^\d{4}$/.test(pin)) {
    res.status(400).json({ error: 'PIN required' });
    return;
  }
  const result = await findUserByPin(pin);
  if (!result.ok) {
    res.status(401).json({ error: 'Invalid PIN' });
    return;
  }
  const user = result.user;

  // Last 14 days of punches
  const { rows } = await query(
    `SELECT id, location_id, type, ts, flagged
     FROM timeclock.punches
     WHERE user_id = $1 AND ts >= NOW() - INTERVAL '14 days'
     ORDER BY ts DESC`,
    [user.id]
  );

  res.json({
    user: { id: user.id, name: user.name },
    punches: rows,
  });
});

export default router;
