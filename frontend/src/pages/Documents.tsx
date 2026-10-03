import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, ago, can, Doc } from '../api';
import { useAuth } from '../auth';
import { useDebounced, useFetch } from '../hooks';

export default function Documents() {
  const { user } = useAuth();
  const nav = useNavigate();
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const dq = useDebounced(q);
  const params = new URLSearchParams({ ...(dq && { q: dq }), ...(status && { status }) });
  const { data, error, loading, reload } = useFetch<{ items: Doc[] }>(`/documents?${params}`);

  async function create() {
    const d = await api<Doc>('/documents', { method: 'POST', idempotent: true, body: { title: 'Untitled document', body: '# New document\n' } });
    nav(`/docs/${d.id}`);
  }
  return (
    <>
      <div className="row between">
        <h1>Documents</h1>
        {can(user, 'editor') && <button className="primary" onClick={create}>New document</button>}
      </div>
      <div className="row gap">
        <label className="grow"><span className="sr">Search documents</span>
          <input type="search" placeholder="Search titles and content…" value={q} onChange={(e) => setQ(e.target.value)} /></label>
        {can(user, 'editor') && <label><span className="sr">Status</span>
          <select value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">All statuses</option><option value="draft">Draft</option><option value="in_review">In review</option>
            <option value="approved">Approved</option><option value="published">Published</option>
          </select></label>}
      </div>
      <div aria-live="polite">
        {loading && <p className="muted">Loading…</p>}
        {error && <p className="error" role="alert">{error} <button className="link" onClick={reload}>Retry</button></p>}
        {data && !data.items.length && !loading && <p className="muted">No documents found.</p>}
      </div>
      <ul className="cards">
        {data?.items.map((d) => (
          <li key={d.id}>
            <Link to={`/docs/${d.id}`}><h2>{d.title}</h2></Link>
            {d.snippet && <p className="snippet" dangerouslySetInnerHTML={{ __html: escapeMark(d.snippet) }} />}
            <p className="meta"><span className={`pill st-${d.status}`}>{d.status.replace('_', ' ')}</span> v{d.current_version} · {d.owner_name} · {ago(d.updated_at)} · <code>DOC-{d.id.slice(0, 8)}</code></p>
          </li>
        ))}
      </ul>
    </>
  );
}
// ts_headline returns <b>…</b>; escape everything else before injecting.
const escapeMark = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/&lt;(\/?)b>/g, '<$1mark>');
