// One-time seed: insert the 3 Glisten offices + Annie Simmons (PIN 1111) +
// Anas + Dr. Dawood as owners. Idempotent: re-running is safe.
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

  // Annie Simmons — first real employee, PIN 1111. Dedupe by name since the
  // schema doesn't have a unique constraint that ON CONFLICT could target.
  const anniePin = await hashPin('1111');
  const annieExisting = await query<{ id: number }>(
    `SELECT id FROM timeclock.users WHERE name = $1 AND active = true`,
    ['Annie Simmons'],
  );
  if (annieExisting.rows.length === 0) {
    await query(
      `INSERT INTO timeclock.users
         (name, pin_hash, role, employment_type, is_owner, is_manager, track_hours, active)
       VALUES ($1, $2, $3, $4, false, false, true, true)`,
      ['Annie Simmons', anniePin, 'front_desk', 'W2'],
    );
    console.log('  ✓ user: Annie Simmons (PIN 1111)');
  } else {
    console.log('  ✓ user: Annie Simmons (already seeded)');
  }

  // Owners don't punch (track_hours = false). They log into the manager
  // dashboard with a username + 4-digit PIN. Same bcrypt lookup as the
  // kiosk PIN, but findUserByPin won't return them since track_hours = false.
  await upsertOwner({
    name: 'Anas Hasic',
    username: 'anas',
    pin: process.env.SEED_ANAS_PIN || '0000',
    email: process.env.SEED_ANAS_EMAIL || 'team@holocronhq.com',
    role: 'owner',
  });
  await upsertOwner({
    name: 'Dr. Revan Dawood',
    username: 'revandawood',
    pin: process.env.SEED_DAWOOD_PIN || '1996',
    email: process.env.SEED_DAWOOD_EMAIL || 'dawood@glistendental.com',
    role: 'doctor',
  });

  await pool.end();
  console.log('\nSeed complete. Note: office lat/lng are placeholders — update before launch.');
}

async function upsertOwner({
  name,
  username,
  pin,
  email,
  role,
}: {
  name: string;
  username: string;
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
    `SELECT id FROM timeclock.users
     WHERE LOWER(username) = LOWER($1) AND active = true`,
    [username],
  );
  if (existing.rows.length > 0) {
    await query(
      `UPDATE timeclock.users
       SET name = $2, pin_hash = $3, role = $4, email = $5,
           is_owner = true, is_manager = true, track_hours = false,
           updated_at = NOW()
       WHERE id = $1`,
      [existing.rows[0].id, name, pinHash, role, email ?? null],
    );
    console.log(`  ✓ owner updated: ${name} (username: ${username}, PIN: ${pin})`);
    return;
  }
  await query(
    `INSERT INTO timeclock.users
       (name, username, email, pin_hash, role, employment_type,
        is_owner, is_manager, track_hours, active)
     VALUES ($1, $2, $3, $4, $5, $6, true, true, false, true)`,
    [name, username, email ?? null, pinHash, role, 'W2'],
  );
  console.log(`  ✓ owner created: ${name} (username: ${username}, PIN: ${pin})`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
