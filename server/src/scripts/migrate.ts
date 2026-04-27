// Apply numbered SQL migrations in /migrations/ to the timeclock schema.
// Tracks applied versions in timeclock.schema_versions.

import { readFileSync, readdirSync } from 'fs';
import { resolve } from 'path';
import { pool, query } from '../db';

async function main() {
  const dir = resolve(__dirname, '../../../migrations');
  const files = readdirSync(dir)
    .filter(f => /^\d{3}_.+\.sql$/.test(f))
    .sort();

  if (files.length === 0) {
    console.log('No migrations found');
    process.exit(0);
  }

  // schema_versions may not exist on the very first run — bootstrap by
  // running 001 unconditionally if no schema_versions table exists.
  let applied: Set<string> = new Set();
  try {
    const r = await query<{ version: string }>(
      `SELECT version FROM timeclock.schema_versions`
    );
    applied = new Set(r.rows.map(r => r.version));
  } catch {
    // schema_versions doesn't exist yet — first migration will create it.
  }

  for (const f of files) {
    const version = f.replace(/\.sql$/, '');
    if (applied.has(version)) {
      console.log(`✓ ${version} (already applied)`);
      continue;
    }
    const sql = readFileSync(resolve(dir, f), 'utf8');
    console.log(`→ Applying ${version} ...`);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query(
        `INSERT INTO timeclock.schema_versions (version) VALUES ($1) ON CONFLICT DO NOTHING`,
        [version]
      );
      await client.query('COMMIT');
      console.log(`  ✓ ${version} applied`);
    } catch (err) {
      await client.query('ROLLBACK');
      console.error(`  ✗ ${version} failed:`, err);
      process.exit(1);
    } finally {
      client.release();
    }
  }
  await pool.end();
  console.log('All migrations applied.');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
