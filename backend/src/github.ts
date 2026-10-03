import { q } from './db.js';
import { extractDocRefs } from './util.js';

async function gh(path: string, token: string, tries = 3): Promise<any> {
  let last: unknown;
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(`https://api.github.com${path}`, {
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'User-Agent': 'teamflow-cms' },
        signal: AbortSignal.timeout(8000),
      });
      if (res.status === 429 || res.status >= 500) throw new Error(`GitHub ${res.status}`);
      if (!res.ok) throw Object.assign(new Error(`GitHub ${res.status}`), { fatal: true });
      return res.json();
    } catch (e: any) {
      last = e;
      if (e.fatal) break;
      await new Promise((r) => setTimeout(r, 300 * 2 ** i)); // retry w/ exponential backoff
    }
  }
  throw last;
}
export const fetchRepo = (repo: string, token: string) => gh(`/repos/${repo}`, token);
export const fetchCommits = (repo: string, token: string) => gh(`/repos/${repo}/commits?per_page=30`, token);
export const fetchPulls = (repo: string, token: string) => gh(`/repos/${repo}/pulls?state=all&per_page=30`, token);

export interface RepoEvent { kind: 'commit' | 'pr'; externalId: string; title: string; url: string; author: string; state: string; occurredAt: string }

export async function upsertEvent(integrationId: string, e: RepoEvent) {
  const { rows } = await q(
    `insert into repo_events (integration_id, kind, external_id, title, url, author, state, occurred_at)
     values ($1,$2,$3,$4,$5,$6,$7,$8)
     on conflict (integration_id, kind, external_id) do update set title=excluded.title, state=excluded.state
     returning id`,
    [integrationId, e.kind, e.externalId, e.title, e.url, e.author, e.state, e.occurredAt]);
  // auto-link: any "DOC-<first 8 chars of doc id>" reference in the commit message / PR title
  for (const ref of extractDocRefs(e.title)) {
    await q(`insert into document_links (document_id, repo_event_id)
             select id, $2 from documents where id::text like $1 || '%' on conflict do nothing`, [ref, rows[0].id]);
  }
  return rows[0].id as string;
}
export const mapCommit = (c: any): RepoEvent => ({
  kind: 'commit', externalId: c.sha, title: String(c.commit.message).split('\n')[0], url: c.html_url,
  author: c.author?.login || c.commit.author?.name || 'unknown', state: 'committed', occurredAt: c.commit.author?.date,
});
export const mapPull = (p: any): RepoEvent => ({
  kind: 'pr', externalId: String(p.number), title: p.title, url: p.html_url, author: p.user?.login || 'unknown',
  state: p.merged_at ? 'merged' : p.state, occurredAt: p.updated_at,
});
