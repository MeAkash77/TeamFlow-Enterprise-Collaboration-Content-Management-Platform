import type { Request } from 'express';
import { config } from './config.js';
import { logger } from './logger.js';

/** Fire-and-forget write to the Java audit service. Never blocks or fails the request. */
export function audit(req: Request, action: string, entity: string, entityId?: string, detail: object = {}) {
  fetch(`${config.auditUrl}/internal/audit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Internal-Key': config.auditKey },
    body: JSON.stringify({
      action, entity, entityId, actorId: req.user?.id, actorEmail: req.user?.email,
      ip: req.ip, requestId: String(req.id ?? ''), detail,
    }),
    signal: AbortSignal.timeout(2000),
  }).catch((err) => logger.warn({ err: String(err), action }, 'audit write failed'));
}
