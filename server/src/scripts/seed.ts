// One-time seed: insert the 3 Glisten offices + Annie Simmons (PIN 1111) +
// Anas + Dr. Dawood as owners. Idempotent: re-running is safe.
//
// Owner login is now PIN-only (no username) — Anas + Dr. Dawood get unique
// 4-digit PINs that route them straight into the manager portal from
// either the kiosk or /manage. Defaults can be overridden via env.
//
// Office coordinates from the US Census geocoder against the public street
// addresses. Geofence radius is 150m to absorb GPS jitter — front-desk PCs
// fall back to WiFi positioning, which can drift up to ~100m indoors.

import { hashPin } from '../auth/pin';
import bcrypt from 'bcrypt';
import { pool, query } from '../db';

const OFFICES = [
  {
    slug: 'glisten-gilbert',
    name: 'Glisten Dental Studio',
    address: '4365 E Pecos Rd, Ste 127, Gilbert, AZ 85295',
    lat: 33.289685,
    lng: -111.694468,
    geofence_m: 150,
  },
  {
    slug: 'glisten-mesa',
    name: 'Glisten Dental Mesa',
    address: '633 N Gilbert Rd, Mesa, AZ 85213',
    lat: 33.427361,
    lng: -111.787988,
    geofence_m: 150,
  },
  {
    slug: 'glisten-glendale',
    name: 'Glisten Dental Glendale',
    address: '4901 W Bell Rd, Glendale, AZ 85308',
    lat: 33.639038,
    lng: -112.164856,
    geofence_m: 150,
  },
];

async function main() {
  for (const o of OFFICES) {
    await query(
      `INSERT INTO timeclock.locations (slug, name, address, lat, lng, geofence_m, active)
       VALUES ($1, $2, $3, $4, $5, $6, true)
       ON CONFLICT (slug) DO UPDATE SET
         name = EXCLUDED.name,
         address = EXCLUDED.address,
         lat = EXCLUDED.lat,
         lng = EXCLUDED.lng,
         geofence_m = EXCLUDED.geofence_m,
         updated_at = NOW()`,
      [o.slug, o.name, o.address, o.lat, o.lng, o.geofence_m]
    );
    console.log(`  ✓ location: ${o.slug}`);
  }

  // Annie Simmons — first real employee, PIN 1111. Pre-approved (manually
  // seeded, doesn't go through the self-register approval gate).
  await upsertEmployee({
    name: 'Annie Simmons',
    pin: '1111',
    role: 'front_desk',
  });

  // Owners — track_hours = false so they don't show up on the kiosk
  // employee flow. Their PINs route them straight into the manager portal.
  await upsertOwner({
    name: 'Anas Hasic',
    pin: process.env.SEED_ANAS_PIN || '2263',
    email: process.env.SEED_ANAS_EMAIL || 'team@holocronhq.com',
    role: 'owner',
  });
  await upsertOwner({
    name: 'Dr. Revan Dawood',
    pin: process.env.SEED_DAWOOD_PIN || '0590',
    email: process.env.SEED_DAWOOD_EMAIL || 'dawood@glistendental.com',
    role: 'doctor',
  });

  await pool.end();
  console.log('\nSeed complete.');
}

async function upsertEmployee({
  name,
  pin,
  role,
}: {
  name: string;
  pin: string;
  role: string;
}) {
  const existing = await query<{ id: number }>(
    `SELECT id FROM timeclock.users WHERE name = $1 AND active = true`,
    [name],
  );
  const pinHash = await hashPin(pin);
  if (existing.rows.length > 0) {
    await query(
      `UPDATE timeclock.users
       SET pin_hash = $1, role = $2, approved = true, updated_at = NOW()
       WHERE id = $3`,
      [pinHash, role, existing.rows[0].id],
    );
    console.log(`  ✓ employee updated: ${name} (PIN ${pin})`);
    return;
  }
  await query(
    `INSERT INTO timeclock.users
       (name, pin_hash, role, employment_type,
        is_owner, is_manager, track_hours, active, approved, self_registered)
     VALUES ($1, $2, $3, 'W2', false, false, true, true, true, false)`,
    [name, pinHash, role],
  );
  console.log(`  ✓ employee created: ${name} (PIN ${pin})`);
}

async function upsertOwner({
  name,
  pin,
  email,
  role,
}: {
  name: string;
  pin: string;
  email?: string;
  role: string;
}) {
  if (!/^\d{4}$/.test(pin)) {
    console.log(`  ⚠ invalid PIN for ${name}; skipping`);
    return;
  }
  const pinHash = await bcrypt.hash(pin, 10);

  const existing = await query<{ id: number }>(
    `SELECT id FROM timeclock.users WHERE name = $1`,
    [name],
  );
  if (existing.rows.length > 0) {
    await query(
      `UPDATE timeclock.users
       SET pin_hash = $2, role = $3, email = $4,
           is_owner = true, is_manager = true, track_hours = false,
           active = true, approved = true,
           updated_at = NOW()
       WHERE id = $1`,
      [existing.rows[0].id, pinHash, role, email ?? null],
    );
    console.log(`  ✓ owner updated: ${name} (PIN ${pin})`);
    return;
  }
  await query(
    `INSERT INTO timeclock.users
       (name, email, pin_hash, role, employment_type,
        is_owner, is_manager, track_hours, active, approved)
     VALUES ($1, $2, $3, $4, 'W2', true, true, false, true, true)`,
    [name, email ?? null, pinHash, role],
  );
  console.log(`  ✓ owner created: ${name} (PIN ${pin})`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
