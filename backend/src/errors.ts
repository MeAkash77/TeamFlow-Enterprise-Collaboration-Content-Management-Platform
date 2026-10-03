import type { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';
import { logger } from './logger.js';

export class HttpError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction) {
  if (err instanceof ZodError) return res.status(400).json({ error: 'validation_failed', details: err.flatten() });
  if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
  logger.error({ err, reqId: req.id }, 'unhandled error');
  res.status(500).json({ error: 'internal_error' });
}
