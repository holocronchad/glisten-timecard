import { Router } from 'express';
import { query } from '../db';

const router = Router();

router.get('/', async (_req, res) => {
  const status: any = { service: 'glisten-timecard', status: 'ok', ts: new Date().toISOString() };
  try {
    const r = await query('SELECT 1 AS ok');
    status.db = r.rows[0].ok === 1 ? 'connected' : 'unknown';
  } catch (err: any) {
    status.db = 'error';
    status.db_error = err.message;
    status.status = 'degraded';
  }
  res.status(status.status === 'ok' ? 200 : 503).json(status);
});

export default router;
