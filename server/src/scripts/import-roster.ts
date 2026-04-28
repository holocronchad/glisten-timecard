// One-time roster preload — inserts each staff member with metadata
// (name, role, rate, employment_type, track_hours) but NO PIN. Employees
// set their own PIN at the kiosk via the self-register flow, which
// matches their first+last name to a roster row with pin_hash = NULL
// and fills the PIN in.
//
// Idempotent: matches by name (case-insensitive) and updates metadata
// only — never overwrites a PIN that's already been set.
//
// Salaried + commission folks (Baer, Parsa, Raulston) get
// track_hours = false: they appear in the staff list but don't show in
// the kiosk flow. The "this account does not punch the clock" gate fires
// if they enter a PIN.
//
// Source: Glisten Dental LLC Masterlist - Resources.xlsx - Roster.pdf
// Generated: 2026-04-28.
//
// Excluded:
//   - Anas Hasic       — owner, seeded by seed.ts
//   - Dr. Revan Dawood — owner, seeded by seed.ts

import { pool, query } from '../db';

interface RosterEntry {
  name: string;
  role: string;
  employment_type: 'W2' | '1099';
  pay_rate_cents: number | null;
  track_hours: boolean;
  /** Free-text note that lands in the audit log for context. */
  note?: string;
}

const ROSTER: RosterEntry[] = [
  // ── Mesa ──────────────────────────────────────────────────────────────
  {
    name: 'Parsa Owtad',
    role: 'contractor',
    employment_type: '1099',
    pay_rate_cents: null,
    track_hours: false,
    note: 'Commission only — no clock punching',
  },
  {
    name: 'Joshua James Baer',
    role: 'dentist',
    employment_type: 'W2',
    pay_rate_cents: null,
    track_hours: false,
    note: 'Salary $800/day Mesa, commission Gilbert — no clock punching',
  },
  { name: 'Cynthia Casas',     role: 'dental_assistant', employment_type: 'W2', pay_rate_cents: 2500, track_hours: true },
  { name: 'Aubrey Hanks',      role: 'hygienist',        employment_type: 'W2', pay_rate_cents: 5700, track_hours: true, note: 'Works Mesa + Gilbert' },
  { name: 'Sofia Hernandez',   role: 'dental_assistant', employment_type: 'W2', pay_rate_cents: 2500, track_hours: true },
  { name: 'Aayushi Parikh',    role: 'front_desk',       employment_type: 'W2', pay_rate_cents: 2900, track_hours: true },
  { name: 'Annie Simmons',     role: 'dental_assistant', employment_type: 'W2', pay_rate_cents: 2700, track_hours: true },
  { name: 'Ayda Reshidi',      role: 'dental_assistant', employment_type: 'W2', pay_rate_cents: 2100, track_hours: true },

  // ── Gilbert ───────────────────────────────────────────────────────────
  { name: 'Ashley Araque',     role: 'dental_assistant', employment_type: 'W2', pay_rate_cents: 2900, track_hours: true },
  { name: 'Natalie Gonzalez',  role: 'dental_assistant', employment_type: 'W2', pay_rate_cents: 2700, track_hours: true },
  { name: 'Grace Griffith',    role: 'dental_assistant', employment_type: 'W2', pay_rate_cents: 3500, track_hours: true },
  { name: 'Jenna Henderson',   role: 'hygienist',        employment_type: 'W2', pay_rate_cents: 5600, track_hours: true },
  {
    name: 'Jaime Raulston',
    role: 'billing',
    employment_type: 'W2',
    pay_rate_cents: null,
    track_hours: false,
    note: 'Salaried $1,250/paycheck — no clock punching',
  },
  {
    name: 'Filza Tirmizi',
    role: 'dental_assistant',
    employment_type: 'W2',
    pay_rate_cents: 3100,
    track_hours: true,
    note: 'Dual classification: W2 $31/hr (primary) + 1099 contractor $21/hr. Two PINs (office + WFH/remote) — owner sets both manually.',
  },
  { name: 'Mesha Dosch',       role: 'front_desk',       employment_type: 'W2', pay_rate_cents: 3000, track_hours: true },

  // ── Glendale ──────────────────────────────────────────────────────────
  { name: 'Michelle Paschal',  role: 'dental_assistant', employment_type: 'W2', pay_rate_cents: 2600, track_hours: true },
  {
    name: 'Maria Yeni Pelayo Rueles',
    role: 'front_desk',
    employment_type: 'W2',
    pay_rate_cents: 3100,
    track_hours: true,
  },
];

async function main() {
  console.log(`\nGlisten Timecard — roster preload (${ROSTER.length} entries)`);
  console.log('  PINs are NOT set here — employees self-register at the kiosk.\n');

  let created = 0;
  let updated = 0;
  let skipped = 0;

  for (const entry of ROSTER) {
    const existing = await query<{ id: number; pin_hash: string | null; name: string }>(
      `SELECT id, pin_hash, name
       FROM timeclock.users
       WHERE LOWER(name) = LOWER($1)`,
      [entry.name],
    );

    if (existing.rows.length === 1) {
      const row = existing.rows[0];
      // Update metadata; preserve PIN if already set.
      await query(
        `UPDATE timeclock.users
         SET name = $1, role = $2, employment_type = $3, pay_rate_cents = $4,
             track_hours = $5, active = true, approved = true,
             updated_at = NOW()
         WHERE id = $6`,
        [
          entry.name,
          entry.role,
          entry.employment_type,
          entry.pay_rate_cents,
          entry.track_hours,
          row.id,
        ],
      );
      const pinNote = row.pin_hash ? 'PIN already set' : 'awaiting PIN';
      console.log(`  ↻ updated:  ${entry.name.padEnd(28)} (${entry.role}, ${pinNote})`);
      updated += 1;
      continue;
    }

    if (existing.rows.length > 1) {
      console.log(`  ⚠ skipped:  ${entry.name} — multiple existing rows match (manual cleanup)`);
      skipped += 1;
      continue;
    }

    // Insert preload row with NULL pin_hash. approved = true because the
    // manager curated this list — the kiosk register flow trusts a name match.
    const { rows: ins } = await query<{ id: number }>(
      `INSERT INTO timeclock.users
         (name, pin_hash, role, employment_type, pay_rate_cents,
          is_owner, is_manager, track_hours, active, approved, self_registered)
       VALUES ($1, NULL, $2, $3, $4, false, false, $5, true, true, false)
       RETURNING id`,
      [entry.name, entry.role, entry.employment_type, entry.pay_rate_cents, entry.track_hours],
    );

    if (entry.note) {
      await query(
        `INSERT INTO timeclock.audit_log
           (actor_user_id, resource_type, resource_id, action, after_state, reason)
         VALUES (NULL, 'user', $1, 'roster_preload', $2::jsonb, $3)`,
        [ins[0].id, JSON.stringify({ name: entry.name, role: entry.role }), entry.note],
      );
    }

    console.log(
      `  + created: ${entry.name.padEnd(28)} (${entry.role}${entry.track_hours ? '' : ', no-clock'})`,
    );
    created += 1;
  }

  console.log(`\n  Summary: ${created} created, ${updated} updated, ${skipped} skipped`);
  console.log(`\nNext step: each employee opens the kiosk, taps "New employee?",`);
  console.log(`enters their first + last name + a 4-digit PIN. The system matches`);
  console.log(`their name to a roster row and fills in their PIN.\n`);

  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
