import { Router } from 'express';
import { z } from 'zod';
import { q, tx } from '../db.js';
import { HttpError } from '../errors.js';
import { requireRole, ROLE_RANK, AuthUser } from '../auth.js';
import { recordActivity } from '../activity.js';
import { audit } from '../audit.js';
import { idempotency } from '../idempotency.js';
import { uuid } from '../util.js';

export const documents = Router();

async function load(id: string, user: AuthUser) {
  const d = (await q(`select d.*, u.name owner_name from documents d join users u on u.id=d.owner_id where d.id=$1`, [id])).rows[0];
  if (!d || (user.role === 'viewer' && d.status !== 'published')) throw new HttpError(404, 'not_found');
  return d;
}
const canManage = (d: any, u: AuthUser) => u.role === 'admin' || (ROLE_RANK[u.role] >= 2 && d.owner_id === u.id);

// Full-text search (Postgres tsvector + GIN) with ranking and highlighted snippets.
documents.get('/', async (req, res) => {
  const term = String(req.query.q || '').trim();
  const status = req.query.status ? String(req.query.status) : null;
  const limit = Math.min(Number(req.query.limit) || 20, 100);
  const offset = Number(req.query.offset) || 0;
  const params: unknown[] = [], where: string[] = [];
  if (req.user!.role === 'viewer') where.push(`d.status='published'`);
  if (status) { params.push(status); where.push(`d.status=$${params.length}`); }
  let select = 'd.id,d.title,d.status,d.current_version,d.updated_at,u.name owner_name';
  let order = 'd.updated_at desc';
  if (term) {
    params.push(term); const n = params.length;
    where.push(`d.search_vector @@ websearch_to_tsquery('english',$${n})`);
    select += `, ts_headline('english', d.body, websearch_to_tsquery('english',$${n}), 'MaxWords=18,MinWords=8') snippet, ts_rank(d.search_vector, websearch_to_tsquery('english',$${n})) rank`;
    order = 'rank desc';
  }
  params.push(limit, offset);
  const sql = `select ${select} from documents d join users u on u.id=d.owner_id ${where.length ? 'where ' + where.join(' and ') : ''}
               order by ${order} limit $${params.length - 1} offset $${params.length}`;
  res.json({ items: (await q(sql, params)).rows });
});

documents.post('/', requireRole('editor'), idempotency, async (req, res) => {
  const { title, body } = z.object({ title: z.string().min(1).max(200), body: z.string().max(200000).default('') }).parse(req.body);
  const doc = await tx(async (c) => {
    const d = (await c.query(`insert into documents (title, body, owner_id) values ($1,$2,$3) returning *`, [title, body, req.user!.id])).rows[0];
    await c.query(`insert into document_versions (document_id, version, title, body, author_id, change_note) values ($1,1,$2,$3,$4,'Initial version')`, [d.id, title, body, req.user!.id]);
    return d;
  });
  await recordActivity(req.user!.id, 'document.created', doc.id, { title });
  audit(req, 'document.create', 'document', doc.id);
  res.status(201).json(doc);
});

documents.get('/:id', async (req, res) => res.json(await load(uuid(req.params.id), req.user!)));

// Optimistic concurrency: client sends the version it edited; stale edits get 409.
documents.put('/:id', requireRole('editor'), async (req, res) => {
  const id = uuid(req.params.id);
  const b = z.object({ title: z.string().min(1).max(200), body: z.string().max(200000), baseVersion: z.number().int(), changeNote: z.string().max(200).optional() }).parse(req.body);
  const doc = await load(id, req.user!);
  if (!canManage(doc, req.user!)) throw new HttpError(403, 'forbidden');
  const updated = await tx(async (c) => {
    const r = await c.query(
      `update documents set title=$2, body=$3, current_version=current_version+1, updated_at=now(),
         status = 'draft'
       where id=$1 and current_version=$4 returning *`, [id, b.title, b.body, b.baseVersion]);
    if (!r.rows[0]) throw new HttpError(409, 'version_conflict');
    await c.query(`insert into document_versions (document_id, version, title, body, author_id, change_note) values ($1,$2,$3,$4,$5,$6)`,
      [id, r.rows[0].current_version, b.title, b.body, req.user!.id, b.changeNote || null]);
    return r.rows[0];
  });
  await recordActivity(req.user!.id, 'document.updated', id, { version: updated.current_version });
  audit(req, 'document.update', 'document', id, { version: updated.current_version });
  res.json(updated);
});

documents.delete('/:id', requireRole('admin'), async (req, res) => {
  const id = uuid(req.params.id);
  await q('delete from documents where id=$1', [id]);
  audit(req, 'document.delete', 'document', id);
  res.status(204).end();
});

documents.get('/:id/versions', async (req, res) => {
  const id = uuid(req.params.id); await load(id, req.user!);
  res.json({ items: (await q(`select v.version, v.title, v.body, v.change_note, v.created_at, u.name author_name
    from document_versions v join users u on u.id=v.author_id where document_id=$1 order by version desc`, [id])).rows });
});

documents.post('/:id/versions/:v/restore', requireRole('editor'), async (req, res) => {
  const id = uuid(req.params.id); const v = Number(req.params.v);
  const doc = await load(id, req.user!);
  if (!canManage(doc, req.user!)) throw new HttpError(403, 'forbidden');
  const old = (await q('select * from document_versions where document_id=$1 and version=$2', [id, v])).rows[0];
  if (!old) throw new HttpError(404, 'version_not_found');
  const updated = await tx(async (c) => {
    const r = (await c.query(`update documents set title=$2, body=$3, current_version=current_version+1, status='draft', updated_at=now() where id=$1 returning *`, [id, old.title, old.body])).rows[0];
    await c.query(`insert into document_versions (document_id, version, title, body, author_id, change_note) values ($1,$2,$3,$4,$5,$6)`,
      [id, r.current_version, old.title, old.body, req.user!.id, `Restored from v${v}`]);
    return r;
  });
  await recordActivity(req.user!.id, 'document.restored', id, { from: v });
  audit(req, 'document.restore', 'document', id, { from: v });
  res.json(updated);
});

// Draft → in_review → approved → published
documents.post('/:id/submit', requireRole('editor'), async (req, res) => {
  const id = uuid(req.params.id); const doc = await load(id, req.user!);
  if (!canManage(doc, req.user!)) throw new HttpError(403, 'forbidden');
  if (doc.status !== 'draft') throw new HttpError(409, 'not_in_draft');
  const r = (await q(`update documents set status='in_review' where id=$1 returning *`, [id])).rows[0];
  await recordActivity(req.user!.id, 'document.submitted', id);
  res.json(r);
});

documents.post('/:id/publish', requireRole('editor'), async (req, res) => {
  const id = uuid(req.params.id); const doc = await load(id, req.user!);
  if (!canManage(doc, req.user!)) throw new HttpError(403, 'forbidden');
  if (doc.status !== 'approved' && req.user!.role !== 'admin') throw new HttpError(409, 'approval_required');
  const r = (await q(`update documents set status='published', published_at=now() where id=$1 returning *`, [id])).rows[0];
  await recordActivity(req.user!.id, 'document.published', id, { version: r.current_version });
  audit(req, 'document.publish', 'document', id, { version: r.current_version });
  res.json(r);
});
