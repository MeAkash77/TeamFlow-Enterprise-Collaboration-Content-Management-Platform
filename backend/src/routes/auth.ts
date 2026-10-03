import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { q } from '../db.js';
import { HttpError } from '../errors.js';
import { authenticate, issueToken, requireRole } from '../auth.js';
import { config } from '../config.js';
import { audit } from '../audit.js';
import { uuid } from '../util.js';

export const publicAuth = Router();
export const userRoutes = Router();

const creds = z.object({ email: z.string().email().toLowerCase(), password: z.string().min(8).max(128) });

publicAuth.post('/register', async (req, res) => {
  const { email, password } = creds.extend({ name: z.string().min(1).max(80) }).parse(req.body);
  const name = req.body.name as string;
  const hash = await bcrypt.hash(password, 10);
  try {
    const { rows } = await q(`insert into users (email,name,password_hash,role) values ($1,$2,$3,'viewer') returning id,email,name,role`, [email, name, hash]);
    audit(req, 'user.register', 'user', rows[0].id);
    res.status(201).json({ token: issueToken(rows[0]), user: rows[0] });
  } catch (e: any) {
    if (e.code === '23505') throw new HttpError(409, 'email_taken');
    throw e;
  }
});

publicAuth.post('/login', async (req, res) => {
  const { email, password } = creds.parse(req.body);
  const u = (await q('select * from users where email=$1', [email])).rows[0];
  if (!u?.password_hash || !(await bcrypt.compare(password, u.password_hash))) {
    audit(req, 'auth.login_failed', 'user', undefined, { email });
    throw new HttpError(401, 'invalid_credentials');
  }
  const user = { id: u.id, email: u.email, name: u.name, role: u.role };
  req.user = user;
  audit(req, 'auth.login', 'user', u.id);
  res.json({ token: issueToken(user), user });
});

// ---- OAuth2 (GitHub authorization-code flow). Enabled only when client id/secret are configured.
publicAuth.get('/github', (_req, res) => {
  if (!config.github.clientId) throw new HttpError(501, 'oauth_not_configured');
  const p = new URLSearchParams({ client_id: config.github.clientId, scope: 'read:user user:email', redirect_uri: `${config.appUrl}/api/auth/github/callback` });
  res.redirect(`https://github.com/login/oauth/authorize?${p}`);
});
publicAuth.get('/github/callback', async (req, res) => {
  if (!config.github.clientId) throw new HttpError(501, 'oauth_not_configured');
  const tok = await (await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST', headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_id: config.github.clientId, client_secret: config.github.clientSecret, code: req.query.code }),
  })).json() as any;
  if (!tok.access_token) throw new HttpError(401, 'oauth_failed');
  const h = { Authorization: `Bearer ${tok.access_token}`, 'User-Agent': 'teamflow-cms' };
  const profile = await (await fetch('https://api.github.com/user', { headers: h })).json() as any;
  const emails = await (await fetch('https://api.github.com/user/emails', { headers: h })).json() as any[];
  const email = (emails.find((e) => e.primary && e.verified)?.email || '').toLowerCase();
  if (!email) throw new HttpError(401, 'no_verified_email');
  const { rows } = await q(
    `insert into users (email,name,role) values ($1,$2,'viewer') on conflict (email) do update set name=users.name returning id,email,name,role`,
    [email, profile.name || profile.login]);
  res.redirect(`${config.appUrl}/login#token=${issueToken(rows[0])}`);
});

userRoutes.get('/auth/me', (req, res) => res.json({ user: req.user }));

userRoutes.get('/users', requireRole('editor'), async (_req, res) => {
  res.json({ items: (await q('select id,name,email,role from users order by name limit 500')).rows });
});
userRoutes.patch('/users/:id/role', requireRole('admin'), async (req, res) => {
  const { role } = z.object({ role: z.enum(['viewer', 'editor', 'admin']) }).parse(req.body);
  const id = uuid(req.params.id);
  const { rows } = await q('update users set role=$2 where id=$1 returning id,email,name,role', [id, role]);
  if (!rows[0]) throw new HttpError(404, 'not_found');
  audit(req, 'user.role_changed', 'user', id, { role });
  res.json(rows[0]);
});
