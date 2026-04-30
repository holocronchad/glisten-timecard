// Kiosk endpoints — used by the front-desk PC kiosk + personal phones.
// PIN-only auth, no persistent session: every action submits PIN + lat/lng.
//
// Lookup is now a discriminated response:
//   404 Unknown PIN              → frontend offers self-register
//   200 { kind: 'manager', ...}  → frontend stores token + redirects to /manage
//   200 { kind: 'employee', ...} → frontend proceeds to NameReveal + punch flow

import { Router } from 'express';
import bcrypt from 'bcrypt';
import { z } from 'zod';
import { findUserByPin, hashPin } from '../auth/pin';
import { signManagerToken } from '../auth/jwt';
import { matchLocation } from '../services/geofence';
import {
  getLatestPunch, nextAllowedPunches, recordPunch,
  shiftRequiresLunchAttestation, LUNCH_ATTESTATION_THRESHOLD_HOURS,
  type PunchType,
} from '../services/punches';
import { cprDaysUntil } from '../services/cpr';
import { matchRoster, type RosterCandidate } from '../services/nameMatch';
import { query } from '../db';

const router = Router();

// ── POST /kiosk/lookup ─────────────────────────────────────────────────────
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
    // Unknown PIN — frontend offers the self-register flow.
    res.status(404).json({ error: 'Unknown PIN', kind: 'unknown' });
    return;
  }

  const { user, usedRemotePin } = result;

  // Manager / owner → mint a JWT and route the kiosk to the manager portal.
  // We do this BEFORE the track_hours check so owners (track_hours = false)
  // are routed correctly.
  if (user.is_owner || user.is_manager) {
    const token = signManagerToken({
      user_id: user.id,
      is_owner: user.is_owner,
      is_manager: user.is_manager,
    });
    res.json({
      kind: 'manager',
      token,
      user: {
        id: user.id,
        name: user.name,
        is_owner: user.is_owner,
        is_manager: user.is_manager,
      },
    });
    return;
  }

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
    kind: 'employee',
    user: {
      id: user.id,
      name: user.name,
      approved: user.approved,
    },
    last_punch: latest ? {
      type: latest.type,
      ts: latest.ts,
      location_id: latest.location_id,
      flagged: latest.flagged,
    } : null,
    allowed_actions: allowed,
    location: inOffice,
    // True only when the standard (geofence-required) PIN was used. WFH PIN
    // sets this to false → frontend can show a "Working from home" indicator
    // and skip the "outside office" warning.
    geofence_required: !usedRemotePin,
    bypass_geofence: usedRemotePin,
    cpr: {
      org: user.cpr_org,
      issued_at: user.cpr_issued_at,
      expires_at: user.cpr_expires_at,
      updated_at: user.cpr_updated_at,
      days_until_expiry: cprDaysUntil(user.cpr_expires_at),
    },
  });
});

// ── POST /kiosk/register ───────────────────────────────────────────────────
// New employee onboarding from the kiosk. Three outcomes:
//
// 1. EXACT — first+last (after normalization, accent-strip, alias check)
//    matches a roster row with pin_hash IS NULL. Sets the PIN immediately.
//    Returns 200 { user, roster_matched: true }.
//
// 2. SUGGEST — fuzzy match (Levenshtein ≤ 2) OR unique first-name hit. No
//    DB write yet. Returns 200 { suggestion: { id, name, role, reason } }
//    so the frontend can show "Did you mean X?" The user clicks Yes →
//    re-POSTs with `confirm_user_id` to commit; or No → re-POSTs with
//    `force_self_register: true` to create a fresh approved=false account.
//
// 3. NONE — falls back to legacy self-register: creates a new user with
//    approved=false. Punches collected, excluded from payroll until a
//    manager approves on the Pending tab.
//
// All paths require geofence (must be inside an office).
const registerSchema = z.object({
  first_name: z.string().trim().min(1).max(60),
  last_name: z.string().trim().min(1).max(60),
  pin: z.string().regex(/^\d{4}$/),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  confirm_user_id: z.number().int().positive().optional(),
  force_self_register: z.boolean().optional(),
});

router.post('/register', async (req, res) => {
  const parsed = registerSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Bad request', issues: parsed.error.issues });
    return;
  }
  const { first_name, last_name, pin, lat, lng, confirm_user_id, force_self_register } =
    parsed.data;

  // Geofence — required so anyone in Phoenix can't self-onboard from their phone.
  const { rows: locations } = await query(
    `SELECT id, lat, lng, geofence_m, active FROM timeclock.locations WHERE active = true`
  );
  const office = matchLocation({ lat, lng }, locations as any);
  if (!office) {
    res.status(403).json({
      error: 'Outside office',
      message: 'You can only register a new account from a Glisten Dental office.',
    });
    return;
  }

  // PIN collision guard — check against every existing PIN (primary + remote).
  const { rows: actives } = await query<{
    id: number;
    pin_hash: string | null;
    pin_hash_remote: string | null;
  }>(
    `SELECT id, pin_hash, pin_hash_remote FROM timeclock.users WHERE active = true`,
  );
  for (const u of actives) {
    if (u.pin_hash && (await bcrypt.compare(pin, u.pin_hash))) {
      res.status(409).json({
        error: 'PIN already in use',
        message: 'That PIN is already taken — pick a different one.',
      });
      return;
    }
    if (u.pin_hash_remote && (await bcrypt.compare(pin, u.pin_hash_remote))) {
      res.status(409).json({
        error: 'PIN already in use',
        message: 'That PIN is already taken — pick a different one.',
      });
      return;
    }
  }

  const fullName = `${first_name} ${last_name}`.replace(/\s+/g, ' ').trim();
  const pinHash = await hashPin(pin);
  const ip =
    (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ||
    req.ip ||
    null;

  // ── Confirm path: employee confirmed a fuzzy/first-name suggestion. Skip
  // matching, just verify the row is still a valid roster preload and fill
  // the PIN.
  if (confirm_user_id) {
    const { rows: confirmRows } = await query<{
      id: number;
      name: string;
      pin_hash: string | null;
    }>(
      `SELECT id, name, pin_hash
       FROM timeclock.users
       WHERE id = $1 AND active = true`,
      [confirm_user_id],
    );
    if (confirmRows.length === 0) {
      res.status(404).json({ error: 'Suggested user no longer exists' });
      return;
    }
    if (confirmRows[0].pin_hash) {
      res.status(409).json({
        error: 'Already claimed',
        message: 'That account already has a PIN. Please ask a manager.',
      });
      return;
    }
    await query(
      `UPDATE timeclock.users
       SET pin_hash = $1, approved = true, updated_at = NOW()
       WHERE id = $2`,
      [pinHash, confirm_user_id],
    );
    await query(
      `INSERT INTO timeclock.audit_log
         (actor_user_id, resource_type, resource_id, action, after_state, reason, ip)
       VALUES (NULL, 'user', $1, 'roster_pin_set',
               $2::jsonb, $3, $4)`,
      [
        confirm_user_id,
        JSON.stringify({
          id: confirm_user_id,
          name: confirmRows[0].name,
          location_id: office.id,
          confirmed_typo: true,
          typed_as: fullName,
        }),
        `Employee confirmed roster suggestion (typed "${fullName}", roster row "${confirmRows[0].name}")`,
        ip,
      ],
    );
    res.status(200).json({
      user: { id: confirm_user_id, name: confirmRows[0].name, approved: true },
      message: `Welcome. You're all set — just enter your PIN whenever you punch.`,
      roster_matched: true,
    });
    return;
  }

  // Pull all roster preload candidates (active, no PIN yet) for matching.
  const { rows: candidateRows } = await query<{
    id: number;
    name: string;
    role: string;
    aliases: string[] | null;
  }>(
    `SELECT id, name, role, aliases
     FROM timeclock.users
     WHERE active = true AND pin_hash IS NULL`,
  );
  const candidates: RosterCandidate[] = candidateRows.map((r) => ({
    id: r.id,
    name: r.name,
    aliases: r.aliases ?? [],
  }));

  if (!force_self_register) {
    const result = matchRoster(first_name, last_name, candidates);

    if (result.kind === 'multi') {
      res.status(409).json({
        error: 'Multiple matches',
        message:
          'More than one staff record matches that name — please ask a manager to set up your PIN.',
      });
      return;
    }

    if (result.kind === 'exact') {
      const matched = result.user;
      await query(
        `UPDATE timeclock.users
         SET pin_hash = $1, approved = true, updated_at = NOW()
         WHERE id = $2`,
        [pinHash, matched.id],
      );
      await query(
        `INSERT INTO timeclock.audit_log
           (actor_user_id, resource_type, resource_id, action, after_state, reason, ip)
         VALUES (NULL, 'user', $1, 'roster_pin_set',
                 $2::jsonb, $3, $4)`,
        [
          matched.id,
          JSON.stringify({
            id: matched.id,
            name: matched.name,
            location_id: office.id,
          }),
          `Employee set their own PIN at kiosk (matched roster row "${matched.name}")`,
          ip,
        ],
      );
      res.status(200).json({
        user: { id: matched.id, name: matched.name, approved: true },
        message: `Welcome, ${first_name}. You're all set — just enter your PIN whenever you punch.`,
        roster_matched: true,
      });
      return;
    }

    if (result.kind === 'suggest') {
      // No DB write — frontend will show "Did you mean X?" and re-POST with
      // confirm_user_id (Yes) or force_self_register (No).
      const { rows: detail } = await query<{ role: string }>(
        `SELECT role FROM timeclock.users WHERE id = $1`,
        [result.user.id],
      );
      res.status(200).json({
        suggestion: {
          id: result.user.id,
          name: result.user.name,
          role: detail[0]?.role ?? null,
          reason: result.reason,
        },
        message:
          result.reason === 'fuzzy'
            ? `Did you mean ${result.user.name}?`
            : `Are you ${result.user.name}?`,
      });
      return;
    }

    // result.kind === 'none' falls through to self-register below.
  }

  // No roster match (or force_self_register). Legacy path: user created
  // with approved=false; manager must approve before payroll counts hours.
  const { rows: inserted } = await query<{ id: number; name: string }>(
    `INSERT INTO timeclock.users
       (name, pin_hash, role, employment_type, is_owner, is_manager,
        track_hours, active, approved, self_registered)
     VALUES ($1, $2, 'staff', 'W2', false, false, true, true, false, true)
     RETURNING id, name`,
    [fullName, pinHash],
  );
  const user = inserted[0];

  await query(
    `INSERT INTO timeclock.audit_log
       (actor_user_id, resource_type, resource_id, action, after_state, reason, ip)
     VALUES (NULL, 'user', $1, 'self_register',
             $2::jsonb, $3, $4)`,
    [
      user.id,
      JSON.stringify({ id: user.id, name: user.name, location_id: office.id }),
      force_self_register
        ? 'Employee declined roster suggestion — registered as new'
        : 'Self-registered at kiosk (no roster match — pending approval)',
      ip,
    ],
  );

  res.status(201).json({
    user: { id: user.id, name: user.name, approved: false },
    message: `Welcome, ${first_name}. You're set up — just enter your PIN to clock in.`,
    roster_matched: false,
  });
});

// ── POST /kiosk/cpr ────────────────────────────────────────────────────────
// Update CPR cert info from the kiosk. PIN-authenticated, no manager
// involvement needed — employees can keep their own cert current.
const cprSchema = z.object({
  pin: z.string().regex(/^\d{4}$/),
  org: z.string().trim().min(1).max(120),
  issued_at: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  expires_at: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

router.post('/cpr', async (req, res) => {
  const parsed = cprSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Bad request', issues: parsed.error.issues });
    return;
  }
  const { pin, org, issued_at, expires_at } = parsed.data;

  if (issued_at >= expires_at) {
    res.status(400).json({
      error: 'Bad dates',
      message: 'Expiry must be after the issued date.',
    });
    return;
  }

  const result = await findUserByPin(pin);
  if (!result.ok) {
    res.status(401).json({ error: result.reason === 'locked' ? 'Locked' : 'Invalid PIN' });
    return;
  }
  const user = result.user;

  const { rows } = await query<{
    cpr_org: string;
    cpr_issued_at: Date;
    cpr_expires_at: Date;
    cpr_updated_at: Date;
  }>(
    `UPDATE timeclock.users
     SET cpr_org = $1,
         cpr_issued_at = $2,
         cpr_expires_at = $3,
         cpr_updated_at = NOW()
     WHERE id = $4
     RETURNING cpr_org, cpr_issued_at, cpr_expires_at, cpr_updated_at`,
    [org, issued_at, expires_at, user.id],
  );

  await query(
    `INSERT INTO timeclock.audit_log
       (actor_user_id, resource_type, resource_id, action, after_state, reason)
     VALUES ($1, 'user', $2, 'cpr_update', $3::jsonb, 'CPR cert updated by employee')`,
    [user.id, user.id, JSON.stringify(rows[0])],
  );

  res.json({
    cpr: {
      org: rows[0].cpr_org,
      issued_at: rows[0].cpr_issued_at,
      expires_at: rows[0].cpr_expires_at,
      updated_at: rows[0].cpr_updated_at,
      days_until_expiry: cprDaysUntil(rows[0].cpr_expires_at),
    },
  });
});

// ── POST /kiosk/punch ──────────────────────────────────────────────────────
// lat/lng are OPTIONAL because WFH-PIN users (whose punches bypass the
// geofence entirely) don't need to send coords. For a regular geofence-
// required punch the resolver below will reject when coords are missing.
const punchSchema = z.object({
  pin: z.string().regex(/^\d{4}$/),
  type: z.enum(['clock_in', 'clock_out', 'lunch_start', 'lunch_end']),
  lat: z.number().min(-90).max(90).optional(),
  lng: z.number().min(-180).max(180).optional(),
  // Optional. When the kiosk gets a 422 attestation_required response on a
  // clock_out attempt, it pops a modal asking why the employee didn't take
  // a lunch break and resubmits with this field set.
  no_lunch_reason: z.string().min(2).max(500).optional(),
});

router.post('/punch', async (req, res) => {
  const parsed = punchSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Bad request', issues: parsed.error.issues });
    return;
  }

  const { pin, type, lat, lng, no_lunch_reason } = parsed.data;
  const result = await findUserByPin(pin);
  if (!result.ok) {
    res.status(401).json({ error: result.reason === 'locked' ? 'Locked' : 'Invalid PIN' });
    return;
  }
  const { user, usedRemotePin } = result;
  if (!user.track_hours) {
    res.status(403).json({ error: 'This account does not punch the clock' });
    return;
  }

  // Fetch latest punch up front — we need it for state machine, geofence
  // relaxation, AND stale-shift auto-close below.
  let latest = await getLatestPunch(user.id);

  // Stale-shift auto-close. If the user is trying to clock_in but the system
  // sees an unclosed clock_in / lunch_start from > 16 hours ago, close it
  // first (with the auto_close source) so this morning's clock_in can proceed.
  // 16 hours covers an overnight + a generous buffer; the daily 6:59 AM AZ
  // cron runs an hour earlier in normal flow, this is the safety net for
  // employees who arrive before the cron has fired.
  if (
    type === 'clock_in' &&
    latest != null &&
    (latest.type === 'clock_in' || latest.type === 'lunch_start') &&
    Date.now() - new Date(latest.ts).getTime() > 16 * 60 * 60 * 1000
  ) {
    const closeType: PunchType = latest.type === 'clock_in' ? 'clock_out' : 'lunch_end';
    const closeTs = new Date(
      new Date(latest.ts).getTime() + 8 * 60 * 60 * 1000  // start + 8h
    );
    await recordPunch({
      userId: user.id,
      locationId: latest.location_id,
      type: closeType,
      source: 'auto_close',
      ts: closeTs,
      flagged: true,
      flagReason: `auto_close_stale_shift_at_clock_in (was ${latest.type} from ${new Date(latest.ts).toISOString()})`,
      autoClosedAt: new Date(),
    });
    latest = await getLatestPunch(user.id);
  }

  // Geofence resolution. Three paths:
  //   1. Remote PIN → no geofence, no location.
  //   2. Inside a known office geofence → tie punch to that office.
  //   3. Outside geofence on a NON-clock_in punch where the previous punch
  //      was at a known office within the last 12 hours → allow, flag for
  //      review, inherit the previous location_id. This unblocks the common
  //      failure where WiFi-based geolocation drifts past the 150m radius
  //      right when the employee is mid-shift transitioning (start lunch,
  //      end lunch, clock out). clock_in stays strict — that's the anti-
  //      fraud boundary, can't allow it from anywhere.
  let officeId: number | null = null;
  let geofenceFlagged = false;
  let geofenceFlagReason: string | null = null;

  if (usedRemotePin) {
    officeId = null;
  } else {
    // Geofence-required PIN: lat/lng are mandatory. WFH PINs above made
    // them optional in the schema; if a non-WFH user reaches here without
    // coords we hard-fail (vs. silently flag/inherit, which would let
    // anyone bypass geofence by stripping coords client-side).
    if (typeof lat !== 'number' || typeof lng !== 'number') {
      res.status(400).json({
        error: 'Location required',
        message: 'Allow location in your browser, then try again.',
      });
      return;
    }
    const { rows: locations } = await query(
      `SELECT id, lat, lng, geofence_m, active FROM timeclock.locations WHERE active = true`
    );
    const office = matchLocation({ lat, lng }, locations as any);
    if (office) {
      officeId = office.id;
    } else {
      // Outside geofence — try the mid-shift relaxation. Anything except
      // clock_in is eligible if we have a known prior office and the last
      // punch is recent.
      const previousOpens: Record<string, PunchType[]> = {
        lunch_end:   ['lunch_start'],
        lunch_start: ['clock_in', 'lunch_end'],
        clock_out:   ['clock_in', 'lunch_end'],
      };
      const eligibleOpens = previousOpens[type] ?? [];
      const isMidShift = type !== 'clock_in';
      const canRelax =
        isMidShift &&
        latest != null &&
        eligibleOpens.includes(latest.type) &&
        latest.location_id != null &&
        Date.now() - new Date(latest.ts).getTime() < 12 * 60 * 60 * 1000;

      if (canRelax && latest && latest.location_id != null) {
        officeId = latest.location_id;
        geofenceFlagged = true;
        geofenceFlagReason =
          `GPS reported outside office geofence at ${type}; auto-allowed because ${latest.type} was recorded at this location ${new Date(latest.ts).toISOString()}.`;
      } else {
        res.status(403).json({
          error: 'Outside office',
          message: 'You can only punch when you are at a Glisten Dental office.',
        });
        return;
      }
    }
  }

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

  // Per-user primary-PIN monitor (added 2026-04-29). Filza Tirmizi (id=16)
  // has a different rate for WFH vs in-office, and her WFH PIN bypasses
  // geofence by design. The concern: she could RDP into an office PC from
  // home and use her primary PIN there — that punch would pass the geofence
  // check (the office PC's browser geolocates inside the office) AND record
  // location_id=office, claiming the in-office rate from home. We can't
  // detect that scenario server-side perfectly, so we surface it for review:
  // every primary-PIN punch from Filza gets flagged so Dr. Dawood sees it
  // in the manager queue and can corroborate against the schedule.
  const PRIMARY_PIN_MONITORED_USERS = new Set<number>([16]);
  let monitorFlagged = false;
  let monitorFlagReason: string | null = null;
  if (PRIMARY_PIN_MONITORED_USERS.has(user.id) && !usedRemotePin) {
    monitorFlagged = true;
    monitorFlagReason = `primary_pin_review: ${user.name} uses a different rate WFH; this punch is in-office, please verify.`;
  }

  const finalFlagged = geofenceFlagged || monitorFlagged;
  const finalFlagReason = [geofenceFlagReason, monitorFlagReason]
    .filter(Boolean)
    .join(' | ') || null;

  // No-lunch attestation gate (Anas + Dr. Dawood 2026-04-29). On a clock_out,
  // if the open shift is ≥ LUNCH_ATTESTATION_THRESHOLD_HOURS hours and has
  // no lunch_start in it, the kiosk must collect a reason from the employee
  // before we record the clock_out. Once the kiosk pops the modal and the
  // employee types a reason, the same request is resubmitted with
  // no_lunch_reason set; we accept it then. Empty / whitespace-only reason
  // also fails so a determined user can't just bypass with " ".
  if (type === 'clock_out') {
    const cleanedReason = (no_lunch_reason ?? '').trim();
    const att = await shiftRequiresLunchAttestation(user.id);
    if (att.required && cleanedReason.length < 2) {
      res.status(422).json({
        error: 'lunch_attestation_required',
        message:
          `You've been on the clock for ${att.hours_worked} hours and ` +
          'haven\'t taken a lunch break. Please tell us why before clocking out.',
        hours_worked: att.hours_worked,
        threshold_hours: LUNCH_ATTESTATION_THRESHOLD_HOURS,
        shift_start: att.shift_start?.toISOString() ?? null,
      });
      return;
    }
  }

  const punch = await recordPunch({
    userId: user.id,
    locationId: officeId,
    type: type as PunchType,
    source: 'kiosk',
    ip,
    lat,
    lng,
    // Remote-PIN punches set geofencePass = true (the punch is allowed) but
    // location_id is null — the punch shows up flagged-as-remote on manager
    // views via the null location_id rather than a flag column.
    // Closing punches outside the geofence are recorded WITH a location_id
    // (inherited from the matching open) AND flagged for manager review.
    geofencePass: !geofenceFlagged,
    flagged: finalFlagged,
    flagReason: finalFlagReason,
    noLunchReason: type === 'clock_out' ? (no_lunch_reason ?? null) : null,
  });

  res.json({
    punch: { id: punch.id, type: punch.type, ts: punch.ts },
    message: messageFor(type as PunchType, user.name),
    location_id: officeId,
    pending_approval: !user.approved,
    remote_punch: usedRemotePin,
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

// ── POST /kiosk/me ─────────────────────────────────────────────────────────
const meSchema = z.object({ pin: z.string().regex(/^\d{4}$/) });

router.post('/me', async (req, res) => {
  const parsed = meSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Bad request' });
    return;
  }
  const result = await findUserByPin(parsed.data.pin);
  if (!result.ok) {
    res.status(401).json({ error: result.reason === 'locked' ? 'Locked' : 'Invalid PIN' });
    return;
  }
  const user = result.user;

  const { rows: punches } = await query(
    `SELECT id, location_id, type, ts, flagged
     FROM timeclock.punches
     WHERE user_id = $1 AND ts >= NOW() - INTERVAL '14 days'
     ORDER BY ts DESC`,
    [user.id],
  );

  const { rows: locations } = await query(
    `SELECT id, name FROM timeclock.locations`,
  );
  const locName = new Map<number, string>();
  for (const l of locations as any[]) locName.set(l.id, l.name);

  res.json({
    user: { id: user.id, name: user.name, approved: user.approved },
    punches: (punches as any[]).map((p) => ({
      ...p,
      location_name: p.location_id ? locName.get(p.location_id) ?? null : null,
    })),
    cpr: {
      org: user.cpr_org,
      issued_at: user.cpr_issued_at,
      expires_at: user.cpr_expires_at,
      updated_at: user.cpr_updated_at,
      days_until_expiry: cprDaysUntil(user.cpr_expires_at),
    },
  });
});

export default router;
