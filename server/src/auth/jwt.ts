// JWT helpers — manager/owner sessions only. Kiosk does NOT use JWT.
import jwt from 'jsonwebtoken';
import { config } from '../config';

export interface ManagerJwtPayload {
  user_id: number;
  is_owner: boolean;
  is_manager: boolean;
  iat?: number;
  exp?: number;
}

export function signManagerToken(payload: Omit<ManagerJwtPayload, 'iat' | 'exp'>): string {
  return jwt.sign(payload, config.jwtSecret, { expiresIn: `${config.jwtTtlHours}h` });
}

export function verifyManagerToken(token: string): ManagerJwtPayload | null {
  try {
    return jwt.verify(token, config.jwtSecret) as ManagerJwtPayload;
  } catch {
    return null;
  }
}
