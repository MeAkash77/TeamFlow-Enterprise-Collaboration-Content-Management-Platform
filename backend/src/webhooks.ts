import crypto from 'node:crypto';
import { q } from './db.js';
import { sign } from './crypto.js';
import { logger } from './logger.js';
import { webhookCounter } from './metrics.js';

const MAX_ATTEMPTS = 5;

/** Enqueue an event for every matching active endpoint (transactional outbox pattern). */
export async function dispatch(event: string, payload: object) {
  await q(
    `insert into webhook_deliveries (endpoint_id, event, payload, idempotency_key)
     select id, $1, $2::jsonb, gen_random_uuid()::text from webhook_endpoints
     where active and ($1 = any(events) or '*' = any(events))`,
    [event, JSON.stringify({ event, occurredAt: new Date().toISOString(), data: payload })],
  );
}

async function attempt(d: any) {
  const ep = (await q('select url, secret from webhook_endpoints where id=$1', [d.endpoint_id])).rows[0];
  const body = JSON.stringify(d.payload);
  let ok = false, error = '';
  try {
    const res = await fetch(ep.url, {
      method: 'POST', body, signal: AbortSignal.timeout(5000),
      headers: {
        'Content-Type': 'application/json',
        'X-TeamFlow-Event': d.event,
        'X-TeamFlow-Delivery': d.idempotency_key, // receivers dedupe on this
        'X-TeamFlow-Signature': sign(ep.secret, body),
      },
    });
    ok = res.ok; if (!ok) error = `HTTP ${res.status}`;
  } catch (e) { error = String(e); }
  const attempts = d.attempts + 1;
  webhookCounter.inc({ result: ok ? 'success' : 'failure' });
  if (ok) await q(`update webhook_deliveries set status='delivered', attempts=$2, last_error=null where id=$1`, [d.id, attempts]);
  else if (attempts >= MAX_ATTEMPTS) await q(`update webhook_deliveries set status='failed', attempts=$2, last_error=$3 where id=$1`, [d.id, attempts, error]);
  else await q( // exponential backoff: 10s, 20s, 40s, 80s
    `update webhook_deliveries set attempts=$2, last_error=$3, next_attempt_at = now() + ($4 || ' seconds')::interval where id=$1`,
    [d.id, attempts, error, String(10 * 2 ** (attempts - 1))]);
}

/** Polling worker. Rows are leased (next_attempt_at pushed out) with SKIP LOCKED so multiple API replicas never double-send. */
export function startWebhookWorker() {
  const timer = setInterval(async () => {
    try {
      const { rows } = await q(
        `update webhook_deliveries set next_attempt_at = now() + interval '30 seconds'
         where id in (select id from webhook_deliveries where status='pending' and next_attempt_at <= now()
                      order by next_attempt_at limit 10 for update skip locked)
         returning *`);
      await Promise.all(rows.map(attempt));
    } catch (err) { logger.error({ err }, 'webhook worker error'); }
  }, 2000);
  return () => clearInterval(timer);
}
export const newKey = () => crypto.randomUUID();
