// Express app factory. Splitting from index.ts so tests can mount without
// binding a port.

import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import { config } from './config';
import healthRouter from './routes/health';
import kioskRouter from './routes/kiosk';
import manageRouter from './routes/manage';

export function buildApp() {
  const app = express();

  // Trust the DO load balancer for x-forwarded-for
  app.set('trust proxy', 1);

  app.use(helmet({
    contentSecurityPolicy: false, // managed at the LB / Cloudflare layer
  }));
  app.use(cors({
    origin: config.isProd ? [
      'https://timecard.glistendental.com',
    ] : true,
    credentials: false,
  }));
  app.use(express.json({ limit: '64kb' }));

  // Global rate limit — generous for the kiosk fast-tap pattern but
  // hard-stops at the brute-force scale.
  const limiter = rateLimit({
    windowMs: 60_000,
    limit: 60,
    standardHeaders: true,
    legacyHeaders: false,
  });
  app.use(limiter);

  // Tighter limit on PIN endpoints — protect against brute force across users
  const pinLimiter = rateLimit({
    windowMs: 60_000,
    limit: 12, // 12 attempts/minute per IP, plenty for legit kiosks
    standardHeaders: true,
    legacyHeaders: false,
  });

  // Tighter limit on manager login to slow brute force on owner accounts
  const loginLimiter = rateLimit({
    windowMs: 60_000,
    limit: 8,
    standardHeaders: true,
    legacyHeaders: false,
  });

  app.use('/health', healthRouter);
  app.use('/kiosk', pinLimiter, kioskRouter);
  app.use('/manage/login', loginLimiter);
  app.use('/manage', manageRouter);

  app.get('/', (_req, res) => {
    res.json({ service: 'glisten-timecard', message: 'Backend up. UI is served separately.' });
  });

  // 404 catch-all
  app.use((_req, res) => {
    res.status(404).json({ error: 'Not found' });
  });

  // Error handler
  app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    // eslint-disable-next-line no-console
    console.error('Unhandled error:', err);
    res.status(500).json({ error: 'Internal error' });
  });

  return app;
}
