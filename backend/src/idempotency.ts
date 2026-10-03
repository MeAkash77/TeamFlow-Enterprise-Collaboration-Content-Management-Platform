import type { NextFunction, Request, Response } from 'express';
import { q } from './db.js';

/** Replays the stored response when a client retries a POST with the same Idempotency-Key. */
export async function idempotency(req: Request, res: Response, next: NextFunction) {
  const key = req.header('Idempotency-Key');
  if (!key || !req.user) return next();
  const hit = await q('select status, body from idempotency_keys where key=$1 and user_id=$2', [key, req.user.id]);
  if (hit.rows[0]) {
    res.setHeader('Idempotent-Replay', 'true');
    return res.status(hit.rows[0].status).json(hit.rows[0].body);
  }
  const orig = res.json.bind(res);
  res.json = (body: any) => {
    if (res.statusCode < 500)
      q('insert into idempotency_keys (key,user_id,status,body) values ($1,$2,$3,$4) on conflict do nothing',
        [key, req.user!.id, res.statusCode, JSON.stringify(body)]).catch(() => {});
    return orig(body);
  };
  next();
}
