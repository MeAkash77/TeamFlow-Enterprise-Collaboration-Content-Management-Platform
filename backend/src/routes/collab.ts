import { Router } from 'express';
import { z } from 'zod';
import { q, tx } from '../db.js';
import { HttpError } from '../errors.js';
import { requireRole } from '../auth.js';
import { recordActivity } from '../activity.js';
import { audit } from '../audit.js';
import { parseMentions, uuid } from '../util.js';

export const collab = Router();

async function assertVisible(id: string, role: string) {
  const d = (await q('select status from documents where id=$1', [id])).rows[0];
  if (!d || (role === 'viewer' && d.status !== 'published')) throw new HttpError(404, 'not_found');
}

collab.get('/documents/:id/comments', async (req, res) => {
  const id = uuid(req.params.id); await assertVisible(id, req.user!.role);
  res.json({ items: (await q(`select c.id, c.body, c.created_at, u.name author_name from comments c join users u on u.id=c.author_id where document_id=$1 order by c.created_at`, [id])).rows });
});

collab.post('/documents/:id/comments', requireRole('editor'), async (req, res) => {
  const id = uuid(req.params.id); await assertVisible(id, req.user!.role);
  const { body } = z.object({ body: z.string().min(1).max(5000) }).parse(req.body);
  const handles = parseMentions(body);
  const comment = await tx(async (c) => {
    const row = (await c.query('insert into comments (document_id, author_id, body) values ($1,$2,$3) returning *', [id, req.user!.id, body])).rows[0];
    if (handles.length)
      await c.query(`insert into mentions (comment_id, user_id) select $1, id from users where split_part(lower(email),'@',1) = any($2) on conflict do nothing`, [row.id, handles]);
    return row;
  });
  await recordActivity(req.user!.id, 'comment.created', id, { commentId: comment.id, mentions: handles });
  res.status(201).json(comment);
});

collab.get('/documents/:id/approvals', async (req, res) => {
  const id = uuid(req.params.id); await assertVisible(id, req.user!.role);
  res.json({ items: (await q(`select a.*, r.name reviewer_name from approvals a join users r on r.id=a.reviewer_id where document_id=$1 order by a.created_at desc`, [id])).rows });
});

collab.post('/documents/:id/approvals', requireRole('editor'), async (req, res) => {
  const id = uuid(req.params.id);
  const { reviewerId } = z.object({ reviewerId: z.string().uuid() }).parse(req.body);
  const d = (await q('select owner_id, current_version, status from documents where id=$1', [id])).rows[0];
  if (!d) throw new HttpError(404, 'not_found');
  if (d.owner_id !== req.user!.id && req.user!.role !== 'admin') throw new HttpError(403, 'forbidden');
  if (reviewerId === req.user!.id) throw new HttpError(400, 'cannot_self_review');
  const reviewer = (await q('select role from users where id=$1', [reviewerId])).rows[0];
  if (!reviewer || reviewer.role === 'viewer') throw new HttpError(400, 'invalid_reviewer');
  const a = (await q(`insert into approvals (document_id, version, requested_by, reviewer_id) values ($1,$2,$3,$4) returning *`, [id, d.current_version, req.user!.id, reviewerId])).rows[0];
  await q(`update documents set status='in_review' where id=$1 and status='draft'`, [id]);
  await recordActivity(req.user!.id, 'approval.requested', id, { reviewerId });
  res.status(201).json(a);
});

collab.post('/approvals/:id/decision', requireRole('editor'), async (req, res) => {
  const id = uuid(req.params.id);
  const { decision, comment } = z.object({ decision: z.enum(['approved', 'rejected']), comment: z.string().max(1000).optional() }).parse(req.body);
  const a = (await q('select * from approvals where id=$1', [id])).rows[0];
  if (!a) throw new HttpError(404, 'not_found');
  if (a.reviewer_id !== req.user!.id && req.user!.role !== 'admin') throw new HttpError(403, 'forbidden');
  if (a.status !== 'pending') throw new HttpError(409, 'already_decided');
  await tx(async (c) => {
    await c.query(`update approvals set status=$2, comment=$3, decided_at=now() where id=$1`, [id, decision, comment || null]);
    // only promote the document if the approved version is still the current one
    await c.query(`update documents set status = $2 where id=$1 and ($2 = 'draft' or current_version = $3)`,
      [a.document_id, decision === 'approved' ? 'approved' : 'draft', a.version]);
  });
  await recordActivity(req.user!.id, `approval.${decision}`, a.document_id, { approvalId: id });
  audit(req, `approval.${decision}`, 'document', a.document_id);
  res.json({ id, status: decision });
});

collab.get('/activity', async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 30, 100);
  const viewer = req.user!.role === 'viewer';
  res.json({ items: (await q(
    `select a.id, a.type, a.meta, a.created_at, u.name actor_name, d.id document_id, d.title document_title
     from activity a left join users u on u.id=a.actor_id left join documents d on d.id=a.document_id
     ${viewer ? `where d.status='published'` : ''} order by a.created_at desc limit $1`, [limit])).rows });
});

// Admin-only view over the Java audit service
collab.get('/audit', requireRole('admin'), async (_req, res) => {
  const { config } = await import('../config.js');
  const r = await fetch(`${config.auditUrl}/internal/audit?limit=50`, { headers: { 'X-Internal-Key': config.auditKey }, signal: AbortSignal.timeout(3000) }).catch(() => null);
  if (!r?.ok) throw new HttpError(502, 'audit_service_unavailable');
  const rows = (await r.json()) as any[];
  res.json({ items: rows.map((x) => ({ ...x, detail: safeParse(x.detail) })) });
});
const safeParse = (s: string) => { try { return JSON.parse(s); } catch { return s; } };
