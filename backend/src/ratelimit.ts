import { Redis } from 'ioredis';
import type { NextFunction, Request, Response } from 'express';
import { config } from './config.js';

export const redis = new Redis(config.redisUrl, { lazyConnect: true, maxRetriesPerRequest: 1, enableOfflineQueue: false });
redis.on('error', () => { /* rate limiting fails open; readiness reports redis state */ });

/** Fixed-window limiter backed by Redis, keyed by client IP. Fails open if Redis is down. */
export async function rateLimit(req: Request, res: Response, next: NextFunction) {
  try {
    const { windowSec, max } = config.rateLimit;
    const win = Math.floor(Date.now() / 1000 / windowSec);
    const key = `rl:${req.ip}:${win}`;
    const n = await redis.incr(key);
    if (n === 1) await redis.expire(key, windowSec);
    res.setHeader('X-RateLimit-Limit', max);
    res.setHeader('X-RateLimit-Remaining', Math.max(0, max - n));
    if (n > max) {
      res.setHeader('Retry-After', windowSec);
      return res.status(429).json({ error: 'rate_limited' });
    }
  } catch { /* fail open */ }
  next();
}
