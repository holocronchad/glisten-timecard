// Daily safety net: close any clock_in or lunch_start that's still open at
// end-of-day. The auto-closed punch lands at start_time + AUTO_CLOSE_DEFAULT_SHIFT_HOURS,
// but capped at the cron's wall-clock moment (so we never write a future TS).
// Every auto-close emits a flagged punch + audit_log entry so a manager can fix it.

import cron from 'node-cron';
import { config } from '../config';
import { query, withTransaction } from '../db';
import { recordPunch } from '../services/punches';

interface OpenRow {
  user_id: number;
  location_id: number | null;
  type: 'clock_in' | 'lunch_start' | 'clock_out' | 'lunch_end';
  ts: Date;
  punch_id: number;
}

export async function runAutoClose(now: Date = new Date()): Promise<{ closed: number }> {
  // Find each user's latest punch — close if it's clock_in or lunch_start.
  const { rows } = await query<OpenRow>(
    `SELECT DISTINCT ON (user_id)
       user_id, location_id, type, ts, id AS punch_id
     FROM timeclock.punches
     ORDER BY user_id, ts DESC`,
  );

  const open = rows.filter((r) => r.type === 'clock_in' || r.type === 'lunch_start');
  let closed = 0;

  for (const o of open) {
    const start = new Date(o.ts);
    const cap = new Date(now);
    const fallback = new Date(start.getTime() + config.autoCloseDefaultShiftHours * 60 * 60_000);
    const ts = fallback < cap ? fallback : cap;

    const closeType: 'clock_out' | 'lunch_end' =
      o.type === 'clock_in' ? 'clock_out' : 'lunch_end';

    await withTransaction(async (client) => {
      const inserted = await recordPunch({
        userId: o.user_id,
        locationId: o.location_id,
        type: closeType,
        source: 'auto_close',
        ts,
        flagged: true,
        flagReason: 'auto_close_open_shift',
        autoClosedAt: now,
        client,
      });
      await client.query(
        `INSERT INTO timeclock.audit_log
           (actor_user_id, resource_type, resource_id, action, before_state, after_state, reason)
         VALUES (NULL, 'punch', $1, 'auto_close', $2, $3, $4)`,
        [
          inserted.id,
          JSON.stringify({ open_punch_id: o.punch_id, open_type: o.type, open_ts: start }),
          JSON.stringify({
            inserted_punch_id: inserted.id,
            type: closeType,
            ts,
            source: 'auto_close',
          }),
          `Auto-closed ${o.type} from ${start.toISOString()} — manager review required`,
        ],
      );
    });
    closed += 1;
  }

  return { closed };
}

export function scheduleAutoClose(): cron.ScheduledTask {
  const expr = config.autoCloseCron;
  // eslint-disable-next-line no-console
  console.log(`[autoClose] scheduling cron: ${expr} (${config.timezone})`);
  return cron.schedule(
    expr,
    async () => {
      try {
        const { closed } = await runAutoClose();
        // eslint-disable-next-line no-console
        console.log(`[autoClose] closed ${closed} open shifts`);
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error('[autoClose] failed:', err);
      }
    },
    { timezone: config.timezone },
  );
}
