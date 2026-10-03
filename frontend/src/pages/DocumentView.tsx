import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import { api, can, Doc } from '../api';
import { useAuth } from '../auth';
import { useFetch } from '../hooks';
import { Approvals, Comments, Links, Versions } from './Panels';

export default function DocumentView() {
  const { id } = useParams();
  const { user } = useAuth();
  const nav = useNavigate();
  const { data: doc, error, loading, reload } = useFetch<Doc>(`/documents/${id}`);
  const [title, setTitle] = useState(''); const [body, setBody] = useState('');
  const [tab, setTab] = useState<'edit' | 'preview'>('preview');
  const [msg, setMsg] = useState('');

  useEffect(() => { if (doc) { setTitle(doc.title); setBody(doc.body); } }, [doc]);
  const html = useMemo(() => DOMPurify.sanitize(marked.parse(body, { async: false }) as string), [body]);
  const canEdit = can(user, 'editor') && !!doc && (user!.role === 'admin' || doc.owner_id === user!.id);
  const dirty = !!doc && (title !== doc.title || body !== doc.body);

  async function run(label: string, fn: () => Promise<unknown>) {
    setMsg(`${label}…`);
    try { await fn(); setMsg(`${label} ✓`); reload(); }
    catch (e: any) { setMsg(e.message === 'version_conflict' ? 'Someone else edited this document. Reload to see the latest version.' : e.message === 'approval_required' ? 'An approval is required before publishing.' : e.message); }
  }
  const save = () => run('Saving', () => api(`/documents/${id}`, { method: 'PUT', body: { title, body, baseVersion: doc!.current_version } }));

  if (loading) return <p className="muted" role="status">Loading…</p>;
  if (error || !doc) return <p className="error" role="alert">{error || 'Not found'} <Link to="/">Back to documents</Link></p>;
  return (
    <div className="doc-layout">
      <article>
        <div className="row between">
          <Link to="/">← Documents</Link>
          <span className="meta"><span className={`pill st-${doc.status}`}>{doc.status.replace('_', ' ')}</span> v{doc.current_version} · <code>DOC-{doc.id.slice(0, 8)}</code></span>
        </div>
        {canEdit ? <input className="title-input" aria-label="Title" value={title} onChange={(e) => setTitle(e.target.value)} /> : <h1>{doc.title}</h1>}
        <div className="row gap" role="toolbar" aria-label="Document actions">
          {canEdit && <div role="tablist" className="tabs">
            <button role="tab" aria-selected={tab === 'edit'} onClick={() => setTab('edit')}>Edit</button>
            <button role="tab" aria-selected={tab === 'preview'} onClick={() => setTab('preview')}>Preview</button></div>}
          {canEdit && <button className="primary" disabled={!dirty} onClick={save}>Save new version</button>}
          {canEdit && doc.status === 'draft' && <button onClick={() => run('Submitting', () => api(`/documents/${id}/submit`, { method: 'POST' }))}>Submit for review</button>}
          {canEdit && (doc.status === 'approved' || user!.role === 'admin') && doc.status !== 'published' &&
            <button onClick={() => run('Publishing', () => api(`/documents/${id}/publish`, { method: 'POST' }))}>Publish</button>}
          {can(user, 'admin') && <button className="danger" onClick={async () => { if (confirm('Delete this document permanently?')) { await api(`/documents/${id}`, { method: 'DELETE' }); nav('/'); } }}>Delete</button>}
        </div>
        <p role="status" className="muted">{msg}</p>
        {canEdit && tab === 'edit'
          ? <textarea className="editor" aria-label="Markdown content" value={body} onChange={(e) => setBody(e.target.value)} spellCheck />
          : <div className="prose" dangerouslySetInnerHTML={{ __html: html }} />}
      </article>
      <aside aria-label="Collaboration">
        <Approvals doc={doc} onChange={reload} />
        <Links doc={doc} />
        <Comments doc={doc} />
        <Versions doc={doc} canEdit={canEdit} onRestore={reload} />
      </aside>
    </div>
  );
}
