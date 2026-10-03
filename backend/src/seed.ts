import bcrypt from 'bcryptjs';
import { pool, q } from './db.js';

const N = Number(process.argv[2] || 200);
const words = 'platform deployment pipeline incident runbook architecture onboarding api gateway latency retention policy review release migration database index cache queue webhook security audit rollback monitoring dashboard alert capacity postgres kubernetes terraform'.split(' ');
const pick = (n: number) => Array.from({ length: n }, () => words[Math.floor(Math.random() * words.length)]).join(' ');

const hash = await bcrypt.hash('Passw0rd!', 10);
const ids: Record<string, string> = {};
for (const [name, role] of [['Ada Admin', 'admin'], ['Eli Editor', 'editor'], ['Vera Viewer', 'viewer']] as const) {
  const email = `${role}@teamflow.dev`;
  const r = await q(`insert into users (email,name,password_hash,role) values ($1,$2,$3,$4)
    on conflict (email) do update set role=excluded.role returning id`, [email, name, hash, role]);
  ids[role] = r.rows[0].id;
}
for (let i = 0; i < N; i++) {
  const title = `${pick(3)} #${i}`;
  const body = `# ${title}\n\n${Array.from({ length: 6 }, () => pick(25)).join('\n\n')}\n`;
  const status = i % 3 === 0 ? 'published' : 'draft';
  const d = await q(`insert into documents (title, body, owner_id, status) values ($1,$2,$3,$4) returning id`, [title, body, ids.editor, status]);
  await q(`insert into document_versions (document_id, version, title, body, author_id, change_note) values ($1,1,$2,$3,$4,'Seeded')`, [d.rows[0].id, title, body, ids.editor]);
}
console.log(`Seeded ${N} documents. Logins: admin@teamflow.dev / editor@teamflow.dev / viewer@teamflow.dev  (password: Passw0rd!)`);
await pool.end();
