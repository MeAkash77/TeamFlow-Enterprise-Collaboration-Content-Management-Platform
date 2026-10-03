import { q } from './db.js';
import { dispatch } from './webhooks.js';
import { logger } from './logger.js';

export async function recordActivity(actorId: string | null, type: string, documentId: string | null, meta: object = {}) {
  await q('insert into activity (actor_id, type, document_id, meta) values ($1,$2,$3,$4)', [actorId, type, documentId, JSON.stringify(meta)]);
  dispatch(type, { actorId, documentId, ...meta }).catch((err) => logger.warn({ err }, 'dispatch failed'));
}
