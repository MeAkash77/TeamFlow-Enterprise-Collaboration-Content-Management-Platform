import { Router } from 'express';
import { z } from 'zod';
import { q } from '../db.js';
import { HttpError } from '../errors.js';
import { requireRole } from '../auth.js';
import { decrypt, encrypt, randomSecret, safeEqual, sign } from '../crypto.js';
import { fetchCommits, fetchPulls, fetchRepo, mapCommit, mapPull, upsertEvent } from '../github.js';
import { config } from '../config.js';
import { audit } from '../audit.js';
import { recordActivity } from '../activity.js';
import { logger } from '../logger.js';
import { uuid } from '../util.js';

// ---- Authenticated routes
export const integrations = Router();

integrations.post('/integrations/github', requireRole('editor'), async (req, res) => {
  const { repo, token } = z.object({ repo: z.string().regex(/^[\w.-]+\/[\w.-]+$/), token: z.string().min(10) }).parse(req.body);
  let meta: any;
  try { meta = await fetchRepo(repo, token); } catch { throw new HttpError(400, 'cannot_access_repository'); }
  const secret = randomSecret();
  const { rows } = await q(
    `insert into integrations (provider, repo, token_enc, webhook_secret, default_branch, created_by)
     values ('github',$1,$2,$3,$4,$5) returning id, repo, default_branch`,
    [repo, encrypt(token), secret, meta.default_branch, req.user!.id]);
  audit(req, 'integration.connect', 'integration', rows[0].id, { repo });
  // Secret is returned once so it can be pasted into the GitHub webhook settings.
  res.status(201).json({ ...rows[0], webhookUrl: `${config.appUrl}/api/hooks/github/${rows[0].id}`, webhookSecret: secret });
});

integrations.get('/integrations', async (_req, res) => {
  res.json({ items: (await q(`select i.id, i.repo, i.default_branch, i.last_synced_at, (select count(*) from repo_events e where e.integration_id=i.id)::int events from integrations i order by i.created_at desc`)).rows });
});

integrations.post('/integrations/:id/sync', requireRole('editor'), async (req, res) => {
  const id = uuid(req.params.id);
  const i = (await q('select * from integrations where id=$1', [id])).rows[0];
  if (!i) throw new HttpError(404, 'not_found');
  const token = decrypt(i.token_enc);
  const [commits, pulls] = await Promise.all([fetchCommits(i.repo, token), fetchPulls(i.repo, token)]).catch(() => { throw new HttpError(502, 'github_unavailable'); });
  for (const c of commits) await upsertEvent(id, mapCommit(c));
  for (const p of pulls) await upsertEvent(id, mapPull(p));
  await q('update integrations set last_synced_at=now() where id=$1', [id]);
  await recordActivity(req.user!.id, 'integration.synced', null, { repo: i.repo, commits: commits.length, pulls: pulls.length });
  res.json({ commits: commits.length, pulls: pulls.length });
});

integrations.get('/integrations/:id/events', async (req, res) => {
  const kind = req.query.kind === 'pr' || req.query.kind === 'commit' ? req.query.kind : null;
  res.json({ items: (await q(`select id, kind, title, url, author, state, occurred_at from repo_events where integration_id=$1 and ($2::text is null or kind=$2) order by occurred_at desc limit 100`, [uuid(req.params.id), kind])).rows });
});

integrations.delete('/integrations/:id', requireRole('admin'), async (req, res) => {
  await q('delete from integrations where id=$1', [uuid(req.params.id)]);
  audit(req, 'integration.delete', 'integration', req.params.id as string);
  res.status(204).end();
});

integrations.get('/documents/:id/links', async (req, res) => {
  res.json({ items: (await q(`select e.id, e.kind, e.title, e.url, e.author, e.state, i.repo from document_links l join repo_events e on e.id=l.repo_event_id join integrations i on i.id=e.integration_id where l.document_id=$1 order by e.occurred_at desc`, [uuid(req.params.id)])).rows });
});
integrations.post('/documents/:id/links', requireRole('editor'), async (req, res) => {
  const { eventId } = z.object({ eventId: z.string().uuid() }).parse(req.body);
  await q('insert into document_links (document_id, repo_event_id) values ($1,$2) on conflict do nothing', [uuid(req.params.id), eventId]);
  res.status(201).json({ ok: true });
});
integrations.delete('/documents/:id/links/:eventId', requireRole('editor'), async (req, res) => {
  await q('delete from document_links where document_id=$1 and repo_event_id=$2', [uuid(req.params.id), uuid(req.params.eventId)]);
  res.status(204).end();
});

// ---- Public inbound webhook (authenticated by HMAC signature, not JWT)
export const githubHook = Router();
githubHook.post('/github/:id', async (req, res) => {
  const i = (await q('select id, webhook_secret from integrations where id=$1', [uuid(req.params.id)])).rows[0];
  if (!i || !req.rawBody) throw new HttpError(404, 'not_found');
  if (!safeEqual(sign(i.webhook_secret, req.rawBody), req.header('x-hub-signature-256') || '')) throw new HttpError(401, 'bad_signature');
  const event = req.header('x-github-event');
  const p = req.body;
  if (event === 'push') for (const c of p.commits || [])
    await upsertEvent(i.id, { kind: 'commit', externalId: c.id, title: String(c.message).split('\n')[0], url: c.url, author: c.author?.username || c.author?.name || 'unknown', state: 'committed', occurredAt: c.timestamp });
  else if (event === 'pull_request') await upsertEvent(i.id, mapPull(p.pull_request));
  logger.info({ event, integration: i.id }, 'github webhook processed');
  res.status(202).json({ ok: true }); // GitHub redelivery is safe: upserts are idempotent
});
