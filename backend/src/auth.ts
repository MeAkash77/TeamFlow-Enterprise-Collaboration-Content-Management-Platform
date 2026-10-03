import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { config } from './config.js';
import { HttpError } from './errors.js';

export type Role = 'viewer' | 'editor' | 'admin';
export const ROLE_RANK: Record<Role, number> = { viewer: 1, editor: 2, admin: 3 };
export interface AuthUser { id: string; email: string; name: string; role: Role }

declare global {
  namespace Express {
    interface Request { user?: AuthUser; rawBody?: Buffer }
  }
}

export const issueToken = (u: AuthUser) =>
  jwt.sign({ sub: u.id, email: u.email, name: u.name, role: u.role }, config.jwtSecret, {
    expiresIn: config.jwtTtl as any, issuer: 'teamflow',
  });

export function authenticate(req: Request, _res: Response, next: NextFunction) {
  const h = req.header('authorization') || '';
  if (!h.startsWith('Bearer ')) throw new HttpError(401, 'missing_token');
  try {
    const p = jwt.verify(h.slice(7), config.jwtSecret, { issuer: 'teamflow' }) as any;
    req.user = { id: p.sub, email: p.email, name: p.name, role: p.role };
    next();
  } catch {
    throw new HttpError(401, 'invalid_token');
  }
}

export const requireRole = (min: Role) => (req: Request, _res: Response, next: NextFunction) => {
  if (!req.user || ROLE_RANK[req.user.role] < ROLE_RANK[min]) throw new HttpError(403, 'forbidden');
  next();
};
