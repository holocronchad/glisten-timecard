// Express middleware: extract + verify the manager JWT from the Authorization
// header. Attaches req.auth on success, returns 401 on failure.

import type { Request, Response, NextFunction } from 'express';
import { verifyManagerToken, type ManagerJwtPayload } from './jwt';

declare global {
  namespace Express {
    interface Request {
      auth?: ManagerJwtPayload;
    }
  }
}

export function requireManager(req: Request, res: Response, next: NextFunction): void {
  const header = req.headers.authorization || '';
  const match = header.match(/^Bearer (.+)$/i);
  if (!match) {
    res.status(401).json({ error: 'Missing token' });
    return;
  }
  const payload = verifyManagerToken(match[1]);
  if (!payload || (!payload.is_manager && !payload.is_owner)) {
    res.status(401).json({ error: 'Invalid token' });
    return;
  }
  req.auth = payload;
  next();
}

export function requireOwner(req: Request, res: Response, next: NextFunction): void {
  const header = req.headers.authorization || '';
  const match = header.match(/^Bearer (.+)$/i);
  if (!match) {
    res.status(401).json({ error: 'Missing token' });
    return;
  }
  const payload = verifyManagerToken(match[1]);
  if (!payload || !payload.is_owner) {
    res.status(401).json({ error: 'Owner only' });
    return;
  }
  req.auth = payload;
  next();
}
