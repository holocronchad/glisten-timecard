// One-off, idempotent: create (or update) SKY — Dr. Dawood's executive
// assistant, working remotely from the Philippines.
//
// ACCESS MODEL — manager, NOT owner (is_manager=true, is_owner=false):
//   Gives her the full day-to-day operational reach Dr. Dawood uses — view +
//   correct everyone's punches, approve self-registrations, lunch/missed
//   review, CPR edits — but NONE of the owner-only controls that could harm
//   the business or the timecard. The requireOwner endpoints (pay/PIN/role/
//   access edits, office + geofence edits, staff creation, payroll sign +
//   CSV export, audit log) all stay closed to her, server-side and in the UI.
//
//   track_hours=false: she never clocks in, never shows in the kiosk flow,
//   and the kiosk geofence is structurally irrelevant to her. Her only entry
//   point is the PIN-only manager portal, which has no geo restriction — so
//   "her login can't be geofenced" holds by construction for a remote worker.
//
//   She also can't change HER OWN hours: the segregation-of-duties guard in
//   punchGuard.ts blocks any actor from mutating their own punches (and she
//   has none anyway).
//
// Re-running is safe: matches by name, updates in place. PIN is collision-
// checked against the live roster (a duplicate 4-digit PIN would make BOTH
// logins ambiguous — findUserByPin refuses a colliding PIN). Override the PIN
// with SKY_PIN=NNNN if 9898 is already taken.
import bcrypt from 'bcrypt';
import { pool, query } from '../db';

const NAME = 'Sky';
const ROLE = 'executive_assistant';
const PIN = process.env.SKY_PIN || '9898';

async function pinCollides(pin: string, excludeUserId?: number): Promise<boolean> {
  const { rows } = await query<{
    id: number;
    pin_hash: string | null;
    pin_hash_remote: string | null;
  }>(
    `SELECT id, pin_hash, pin_hash_remote FROM timeclock.users
     WHERE active = true AND (pin_hash IS NOT NULL OR pin_hash_remote IS NOT NULL)`,
  );
  for (const u of rows) {
    if (excludeUserId && u.id === excludeUserId) continue;
    if (u.pin_hash && (await bcrypt.compare(pin, u.pin_hash))) return true;
    if (u.pin_hash_remote && (await bcrypt.compare(pin, u.pin_hash_remote))) return true;
  }
  return false;
}

async function main() {
  if (!/^\d{4}$/.test(PIN)) {
    throw new Error(`SKY_PIN must be exactly 4 digits, got "${PIN}"`);
  }

  const existing = await query<{ id: number }>(
    `SELECT id FROM timeclock.users WHERE name = $1`,
    [NAME],
  );
  const existingId = existing.rows[0]?.id;

  if (await pinCollides(PIN, existingId)) {
    throw new Error(
      `PIN ${PIN} already belongs to another active user. Pick a different one: ` +
        `SKY_PIN=NNNN node dist/scripts/add-sky.js`,
    );
  }

  const pinHash = await bcrypt.hash(PIN, 10);

  if (existingId) {
    await query(
      `UPDATE timeclock.users
       SET pin_hash = $2, role = $3, employment_type = '1099',
           is_owner = false, is_manager = true, track_hours = false,
           active = true, approved = true, pay_rate_cents = NULL,
           pin_fail_count = 0, pin_fail_window_start = NULL, pin_locked_until = NULL,
           updated_at = NOW()
       WHERE id = $1`,
      [existingId, pinHash, ROLE],
    );
    console.log(`  ✓ updated: ${NAME} (id=${existingId}, manager, PIN ${PIN})`);
  } else {
    const ins = await query<{ id: number }>(
      `INSERT INTO timeclock.users
         (name, email, pin_hash, role, employment_type,
          is_owner, is_manager, track_hours, active, approved)
       VALUES ($1, NULL, $2, $3, '1099', false, true, false, true, true)
       RETURNING id`,
      [NAME, pinHash, ROLE],
    );
    console.log(`  ✓ created: ${NAME} (id=${ins.rows[0].id}, manager, PIN ${PIN})`);
  }

  await pool.end();
  console.log('Done.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
