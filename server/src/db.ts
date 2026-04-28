// Postgres pool, scoped to the `timeclock` schema via search_path.
// Same DO Postgres as Holocron, isolated by schema. No cross-schema queries.
import { Pool, PoolClient } from 'pg';
import { config } from './config';

// DO managed Postgres uses a self-signed CA chain; with the default Node
// trust store, pg's `verify-full` (which sslmode=require now aliases to in
// pg-connection-string v2) rejects it. We strip any sslmode from the URL
// and set rejectUnauthorized=false on the pool — same approach Holocron +
// Tacitus use on the same droplet. The connection is still TLS-encrypted;
// we just don't verify the issuer chain.
const stripSslMode = (url: string) =>
  url.replace(/([?&])sslmode=[^&]*&?/g, '$1').replace(/[?&]$/, '');

const needsSsl =
  /sslmode=/.test(config.databaseUrl) ||
  /\.ondigitalocean\.com/.test(config.databaseUrl);

export const pool = new Pool({
  connectionString: needsSsl ? stripSslMode(config.databaseUrl) : config.databaseUrl,
  ssl: needsSsl ? { rejectUnauthorized: false } : undefined,
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

// Set search_path to the timeclock schema on every checkout, so unqualified
// table names resolve correctly. Belt-and-suspenders: queries also use
// fully-qualified `timeclock.<table>` names where it matters.
pool.on('connect', (client: PoolClient) => {
  client.query(`SET search_path TO ${config.dbSchema}, public`).catch(err => {
    // eslint-disable-next-line no-console
    console.error('Failed to set search_path:', err);
  });
});

pool.on('error', err => {
  // eslint-disable-next-line no-console
  console.error('Unexpected db pool error:', err);
});

export async function query<T = any>(text: string, params: any[] = []): Promise<{ rows: T[]; rowCount: number }> {
  const res = await pool.query(text, params);
  return { rows: res.rows as T[], rowCount: res.rowCount ?? 0 };
}

export async function withTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}
