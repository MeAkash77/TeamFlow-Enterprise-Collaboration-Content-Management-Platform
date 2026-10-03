import { FormEvent, useState } from 'react';
import { api, ago, can, Doc } from '../api';
import { useAuth } from '../auth';
import { useFetch } from '../hooks';

export function Comments({ doc }: { doc: Doc }) {
  const { user } = useAuth();
  const { data, error, reload } = useFetch<{ items: any[] }>(`/documents/${doc.id}/comments`);
  const [text, setText] = useState('');
  async function add(e: FormEvent) {
    e.preventDefault();
    await api(`/documents/${doc.id}/comments`, { method: 'POST', body: { body: text } });
    setText(''); reload();
  }
  return (
    <section className="panel"><h2>Comments</h2>
      {error && <p className="error" role="alert">{error}</p>}
      <ul className="comments">{data?.items.map((c) => (
        <li key={c.id}><strong>{c.author_name}</strong> <span className="muted">{ago(c.created_at)}</span>
          <p>{c.body.split(/(@[\w.-]+)/g).map((p: string, i: number) => p.startsWith('@') ? <span key={i} className="mention">{p}</span> : p)}</p></li>))}
        {data && !data.items.length && <li className="muted">No comments yet.</li>}</ul>
      {can(user, 'editor') && <form onSubmit={add}>
        <label><span className="sr">Add a comment</span><textarea required rows={3} placeholder="Write a comment… use @name to mention" value={text} onChange={(e) => setText(e.target.value)} /></label>
        <button>Comment</button></form>}
    </section>
  );
}

export function Approvals({ doc, onChange }: { doc: Doc; onChange: () => void }) {
  const { user } = useAuth();
  const { data, reload } = useFetch<{ items: any[] }>(`/documents/${doc.id}/approvals`);
  const users = useFetch<{ items: any[] }>(can(user, 'editor') ? '/users' : null);
  const [reviewer, setReviewer] = useState('');
  const [err, setErr] = useState('');
  const isOwner = doc.owner_id === user?.id || user?.role === 'admin';
  const done = () => { reload(); onChange(); };
  async function request(e: FormEvent) {
    e.preventDefault(); setErr('');
    try { await api(`/documents/${doc.id}/approvals`, { method: 'POST', body: { reviewerId: reviewer } }); done(); } catch (e: any) { setErr(e.message); }
  }
  async function decide(id: string, decision: string) {
    await api(`/approvals/${id}/decision`, { method: 'POST', body: { decision } }); done();
  }
  return (
    <section className="panel"><h2>Approvals</h2>
      <ul>{data?.items.map((a) => (
        <li key={a.id}>v{a.version} · {a.reviewer_name} · <span className={`pill ap-${a.status}`}>{a.status}</span>
          {a.status === 'pending' && (a.reviewer_id === user?.id || user?.role === 'admin') &&
            <span className="row gap"><button onClick={() => decide(a.id, 'approved')}>Approve</button><button className="danger" onClick={() => decide(a.id, 'rejected')}>Reject</button></span>}</li>))}
        {data && !data.items.length && <li className="muted">No approval requested.</li>}</ul>
      {isOwner && can(user, 'editor') && <form className="row gap" onSubmit={request}>
        <label className="grow"><span className="sr">Reviewer</span>
          <select required value={reviewer} onChange={(e) => setReviewer(e.target.value)}>
            <option value="">Request review from…</option>
            {users.data?.items.filter((u) => u.role !== 'viewer' && u.id !== user?.id).map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select></label>
        <button>Request</button></form>}
      <p className="error" role="alert">{err}</p>
    </section>
  );
}

export function Versions({ doc, canEdit, onRestore }: { doc: Doc; canEdit: boolean; onRestore: () => void }) {
  const { data } = useFetch<{ items: any[] }>(`/documents/${doc.id}/versions`);
  return (
    <section className="panel"><h2>Version history</h2>
      <ul>{data?.items.slice(0, 15).map((v) => (
        <li key={v.version}>v{v.version} · {v.author_name} · {ago(v.created_at)}{v.change_note && <span className="muted"> — {v.change_note}</span>}
          {canEdit && v.version !== doc.current_version && <button className="link" onClick={async () => { await api(`/documents/${doc.id}/versions/${v.version}/restore`, { method: 'POST' }); onRestore(); }}>Restore</button>}</li>))}</ul>
    </section>
  );
}

export function Links({ doc }: { doc: Doc }) {
  const { user } = useAuth();
  const links = useFetch<{ items: any[] }>(`/documents/${doc.id}/links`);
  const integ = useFetch<{ items: any[] }>('/integrations');
  const [integration, setIntegration] = useState('');
  const events = useFetch<{ items: any[] }>(integration ? `/integrations/${integration}/events` : null);
  async function link(eventId: string) { await api(`/documents/${doc.id}/links`, { method: 'POST', body: { eventId } }); links.reload(); }
  return (
    <section className="panel"><h2>Linked commits & PRs</h2>
      <ul>{links.data?.items.map((l) => (<li key={l.id}><span className="pill">{l.kind === 'pr' ? 'PR' : 'commit'}</span> <a href={l.url} target="_blank" rel="noreferrer noopener">{l.title}</a> <span className="muted">{l.repo}</span></li>))}
        {links.data && !links.data.items.length && <li className="muted">Nothing linked. Reference <code>DOC-{doc.id.slice(0, 8)}</code> in a commit message to auto-link.</li>}</ul>
      {can(user, 'editor') && !!integ.data?.items.length && <>
        <label><span className="sr">Repository</span><select value={integration} onChange={(e) => setIntegration(e.target.value)}>
          <option value="">Link from repository…</option>{integ.data.items.map((i) => <option key={i.id} value={i.id}>{i.repo}</option>)}</select></label>
        {integration && <ul className="events">{events.data?.items.slice(0, 10).map((e) => (
          <li key={e.id}>{e.title} <button className="link" onClick={() => link(e.id)}>Link</button></li>))}</ul>}</>}
    </section>
  );
}
