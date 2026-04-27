// Inserts sample punches for Annie across the last several days so the
// dashboard has something to render. Dev-only — never run against prod.
import { pool, query } from '../db';

async function main() {
  const { rows: users } = await query<{ id: number }>(
    `SELECT id FROM timeclock.users WHERE name = $1 LIMIT 1`,
    ['Annie Simmons'],
  );
  if (users.length === 0) {
    console.error('Annie not seeded — run seed.ts first');
    process.exit(1);
  }
  const annieId = users[0].id;

  const { rows: locs } = await query<{ id: number; slug: string }>(
    `SELECT id, slug FROM timeclock.locations WHERE active = true ORDER BY id`,
  );
  const gilbertId = locs.find((l) => l.slug === 'glisten-gilbert')!.id;

  await query(`DELETE FROM timeclock.punches WHERE user_id = $1`, [annieId]);

  const azOffset = '-07:00';

  function ts(daysAgo: number, hour: number, minute = 0): Date {
    const d = new Date();
    d.setDate(d.getDate() - daysAgo);
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    const hh = String(hour).padStart(2, '0');
    const mn = String(minute).padStart(2, '0');
    return new Date(`${yyyy}-${mm}-${dd}T${hh}:${mn}:00${azOffset}`);
  }

  type Punch = {
    daysAgo: number;
    hour: number;
    minute: number;
    type: 'clock_in' | 'clock_out' | 'lunch_start' | 'lunch_end';
    flagged?: boolean;
    flagReason?: string;
  };

  // Last 5 weekdays + today (in progress)
  const days: Punch[][] = [
    // 5 days ago — full normal day
    [
      { daysAgo: 5, hour: 8, minute: 2, type: 'clock_in' },
      { daysAgo: 5, hour: 12, minute: 15, type: 'lunch_start' },
      { daysAgo: 5, hour: 12, minute: 47, type: 'lunch_end' },
      { daysAgo: 5, hour: 17, minute: 4, type: 'clock_out' },
    ],
    // 4 days ago — late clock-in, normal lunch
    [
      { daysAgo: 4, hour: 8, minute: 23, type: 'clock_in' },
      { daysAgo: 4, hour: 12, minute: 30, type: 'lunch_start' },
      { daysAgo: 4, hour: 13, minute: 5, type: 'lunch_end' },
      { daysAgo: 4, hour: 17, minute: 1, type: 'clock_out' },
    ],
    // 3 days ago — auto-closed (forgot to clock out)
    [
      { daysAgo: 3, hour: 7, minute: 58, type: 'clock_in' },
      { daysAgo: 3, hour: 12, minute: 10, type: 'lunch_start' },
      { daysAgo: 3, hour: 12, minute: 45, type: 'lunch_end' },
      {
        daysAgo: 3,
        hour: 23,
        minute: 59,
        type: 'clock_out',
        flagged: true,
        flagReason: 'auto_close_open_shift',
      },
    ],
    // 2 days ago — short day, no lunch
    [
      { daysAgo: 2, hour: 9, minute: 14, type: 'clock_in' },
      { daysAgo: 2, hour: 14, minute: 32, type: 'clock_out' },
    ],
    // Yesterday — full day
    [
      { daysAgo: 1, hour: 8, minute: 0, type: 'clock_in' },
      { daysAgo: 1, hour: 12, minute: 0, type: 'lunch_start' },
      { daysAgo: 1, hour: 12, minute: 30, type: 'lunch_end' },
      { daysAgo: 1, hour: 16, minute: 58, type: 'clock_out' },
    ],
    // Today — currently on the clock (no clock_out)
    [
      { daysAgo: 0, hour: 8, minute: 7, type: 'clock_in' },
      { daysAgo: 0, hour: 12, minute: 4, type: 'lunch_start' },
      { daysAgo: 0, hour: 12, minute: 41, type: 'lunch_end' },
    ],
  ];

  for (const day of days) {
    for (const p of day) {
      await query(
        `INSERT INTO timeclock.punches
           (user_id, location_id, type, ts, source, geofence_pass, flagged, flag_reason)
         VALUES ($1, $2, $3, $4, 'kiosk', true, $5, $6)`,
        [
          annieId,
          gilbertId,
          p.type,
          ts(p.daysAgo, p.hour, p.minute),
          !!p.flagged,
          p.flagReason ?? null,
        ],
      );
    }
  }

  // One pending missed-punch request
  await query(`DELETE FROM timeclock.missed_punch_requests WHERE user_id = $1`, [annieId]);
  await query(
    `INSERT INTO timeclock.missed_punch_requests
       (user_id, date, type, proposed_ts, reason, status)
     VALUES ($1, $2, $3, $4, $5, 'pending')`,
    [
      annieId,
      ts(2, 9).toISOString().slice(0, 10),
      'clock_in',
      ts(2, 9, 0),
      'Computer was frozen this morning, I started at 9 sharp.',
    ],
  );

  // One audit log entry from a "previous edit"
  await query(
    `INSERT INTO timeclock.audit_log
       (actor_user_id, resource_type, resource_id, action, before_state, after_state, reason, ts)
     VALUES (
       (SELECT id FROM timeclock.users WHERE is_owner = true ORDER BY id LIMIT 1),
       'punch', 0, 'edit',
       $1::jsonb, $2::jsonb,
       'Adjusted clock-in to match office camera log',
       NOW() - INTERVAL '2 days'
     )`,
    [
      JSON.stringify({ type: 'clock_in', ts: ts(4, 8, 30).toISOString(), flagged: false }),
      JSON.stringify({ type: 'clock_in', ts: ts(4, 8, 23).toISOString(), flagged: false }),
    ],
  );

  console.log('Demo punches seeded for Annie:');
  console.log(`  - 5 prior days (incl. one auto-closed shift)`);
  console.log(`  - currently on the clock today`);
  console.log(`  - 1 pending missed-punch request`);
  console.log(`  - 1 historical audit entry`);
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
