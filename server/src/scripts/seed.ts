// One-time seed: insert the 3 Glisten offices + Annie Simmons (PIN 1111) +
// Anas + Dr. Dawood as owners. Idempotent: re-running is safe.
//
// Office GPS coordinates are placeholders — UPDATE before launch with real
// addresses + radii from the Glisten physical locations.

import { hashPin } from '../auth/pin';
import bcrypt from 'bcrypt';
import { pool, query } from '../db';

const OFFICES = [
  {
    slug: 'glisten-gilbert',
    name: 'Glisten Dental Studio',
    address: 'Gilbert, AZ',
    lat: 33.3528,
    lng: -111.7890,
    geofence_m: 100,
  },
  {
    slug: 'glisten-mesa',
    name: 'Glisten Dental Mesa',
    address: 'Mesa, AZ',
    lat: 33.4152,
    lng: -111.8315,
    geofence_m: 100,
  },
  {
    slug: 'glisten-glendale',
    name: 'Glisten Dental Glendale',
    address: 'Glendale, AZ',
    lat: 33.5387,
    lng: -112.1860,
    geofence_m: 100,
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

  // Annie Simmons — first real employee, PIN 1111
  const anniePin = await hashPin('1111');
  await query(
    `INSERT INTO timeclock.users
       (name, pin_hash, role, employment_type, is_owner, is_manager, track_hours, active)
     VALUES ($1, $2, $3, $4, false, false, true, true)
     ON CONFLICT DO NOTHING`,
    ['Annie Simmons', anniePin, 'front_desk', 'W2']
  );
  console.log('  ✓ user: Annie Simmons (PIN 1111)');

  // Owners don't punch (track_hours = false). PIN is required by schema but
  // unused — generate a random non-numeric placeholder per owner so they can't
  // collide with each other in bcrypt.compare.
  await upsertOwner({
    name: 'Anas Hasic',
    email: process.env.SEED_ANAS_EMAIL || 'team@holocronhq.com',
    password: process.env.SEED_ANAS_PASSWORD,
    role: 'owner',
  });
  await upsertOwner({
    name: 'Dr. Dawood',
    email: process.env.SEED_DAWOOD_EMAIL || 'dawood@glistendental.com',
    password: process.env.SEED_DAWOOD_PASSWORD,
    role: 'doctor',
  });

  await pool.end();
  console.log('\nSeed complete. Note: office lat/lng are placeholders — update before launch.');
}

async function upsertOwner({
  name,
  email,
  password,
  role,
}: {
  name: string;
  email: string;
  password?: string;
  role: string;
}) {
  if (!password) {
    console.log(`  ⚠ password not set — skipping owner ${name}`);
    return;
  }
  const passwordHash = await bcrypt.hash(password, 10);
  // Owners don't use kiosk PIN; bcrypt-hash a long random secret so collisions
  // with employee PINs are mathematically impossible.
  const placeholderPin = `OWNER:${Math.random().toString(36).slice(2)}-${Date.now()}`;
  const pinHash = await bcrypt.hash(placeholderPin, 10);

  const existing = await query<{ id: number }>(
    `SELECT id FROM timeclock.users
     WHERE lower(email) = lower($1) AND active = true`,
    [email],
  );
  if (existing.rows.length > 0) {
    await query(
      `UPDATE timeclock.users
       SET name = $2, password_hash = $3, role = $4,
           is_owner = true, is_manager = true, track_hours = false,
           updated_at = NOW()
       WHERE id = $1`,
      [existing.rows[0].id, name, passwordHash, role],
    );
    console.log(`  ✓ owner updated: ${name}`);
    return;
  }
  await query(
    `INSERT INTO timeclock.users
       (name, email, pin_hash, password_hash, role, employment_type,
        is_owner, is_manager, track_hours, active)
     VALUES ($1, $2, $3, $4, $5, $6, true, true, false, true)`,
    [name, email, pinHash, passwordHash, role, 'W2'],
  );
  console.log(`  ✓ owner created: ${name}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
