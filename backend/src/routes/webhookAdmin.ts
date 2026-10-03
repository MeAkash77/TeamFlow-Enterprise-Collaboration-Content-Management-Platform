import { Router } from 'express';
import { z } from 'zod';
import { q } from '../db.js';
import { requireRole } from '../auth.js';
import { randomSecret } from '../crypto.js';
import { audit } from '../audit.js';
import { uuid } from '../util.js';

export const webhookAdmin = Router();
webhookAdmin.use(requireRole('admin'));

webhookAdmin.get('/', async (_req, res) => res.json({ items: (await q('select id,url,events,active,created_at from webhook_endpoints order by created_at desc')).rows }));
webhookAdmin.post('/', async (req, res) => {
  const b = z.object({ url: z.string().url().refine((u) => /^https?:/.test(u)), events: z.array(z.string()).min(1).default(['*']) }).parse(req.body);
  const secret = randomSecret();
  const row = (await q('insert into webhook_endpoints (url,secret,events) values ($1,$2,$3) returning id,url,events', [b.url, secret, b.events])).rows[0];
  audit(req, 'webhook.create', 'webhook', row.id);
  res.status(201).json({ ...row, secret });
});
webhookAdmin.delete('/:id', async (req, res) => { await q('delete from webhook_endpoints where id=$1', [uuid(req.params.id)]); res.status(204).end(); });
webhookAdmin.get('/deliveries', async (_req, res) => res.json({ items: (await q('select id,endpoint_id,event,status,attempts,last_error,created_at from webhook_deliveries order by created_at desc limit 50')).rows }));
