import { FormEvent, useState } from 'react';
import { api, can } from '../api';
import { useAuth } from '../auth';
import { useFetch } from '../hooks';

export default function Integrations() {
  const { user } = useAuth();
  const list = useFetch<{ items: any[] }>('/integrations');
  const [repo, setRepo] = useState(''); const [token, setToken] = useState('');
  const [msg, setMsg] = useState(''); const [created, setCreated] = useState<any>(null);
  const [open, setOpen] = useState<string | null>(null);
  const events = useFetch<{ items: any[] }>(open ? `/integrations/${open}/events` : null);

  async function connect(e: FormEvent) {
    e.preventDefault(); setMsg('');
    try { setCreated(await api('/integrations/github', { method: 'POST', body: { repo, token } })); setRepo(''); setToken(''); list.reload(); }
    catch (e: any) { setMsg(e.message === 'cannot_access_repository' ? 'Could not access that repository with this token.' : e.message); }
  }
  async function sync(id: string) {
    setMsg('Syncing…');
    try { const r = await api<any>(`/integrations/${id}/sync`, { method: 'POST' }); setMsg(`Imported ${r.commits} commits and ${r.pulls} pull requests.`); list.reload(); events.reload(); }
    catch (e: any) { setMsg(e.message); }
  }
  return (
    <>
      <h1>Integrations</h1>
      <p className="muted">Connect a GitHub repository to import commits and pull requests, then link them to documents. Mention <code>DOC-&lt;id&gt;</code> in a commit message or PR title to link automatically.</p>
      {can(user, 'editor') && (
        <form className="panel" onSubmit={connect}>
          <h2>Connect repository</h2>
          <label>Repository<input required placeholder="owner/name" pattern="[\w.\-]+/[\w.\-]+" value={repo} onChange={(e) => setRepo(e.target.value)} /></label>
          <label>Personal access token<input required type="password" value={token} onChange={(e) => setToken(e.target.value)} autoComplete="off" /></label>
          <button className="primary">Connect</button>
        </form>
      )}
      <p role="status" className="muted">{msg}</p>
      {created && <div className="panel note"><strong>Webhook setup (shown once)</strong>
        <p>Payload URL: <code>{created.webhookUrl}</code><br />Secret: <code>{created.webhookSecret}</code><br />Content type: application/json · Events: Push, Pull requests</p></div>}
      {list.error && <p className="error" role="alert">{list.error}</p>}
      <ul className="cards">
        {list.data?.items.map((i) => (
          <li key={i.id}>
            <h2>{i.repo}</h2>
            <p className="meta">{i.events} events · {i.last_synced_at ? `synced ${new Date(i.last_synced_at).toLocaleString()}` : 'never synced'}</p>
            <div className="row gap">
              {can(user, 'editor') && <button onClick={() => sync(i.id)}>Sync now</button>}
              <button onClick={() => setOpen(open === i.id ? null : i.id)}>{open === i.id ? 'Hide' : 'View'} commits & PRs</button>
            </div>
            {open === i.id && (events.loading ? <p className="muted">Loading…</p> :
              <ul className="events">{events.data?.items.map((e) => (
                <li key={e.id}><span className="pill">{e.kind === 'pr' ? 'PR' : 'commit'}</span> <a href={e.url} target="_blank" rel="noreferrer noopener">{e.title}</a> <span className="muted">{e.author} · {e.state}</span></li>))}</ul>)}
          </li>
        ))}
      </ul>
    </>
  );
}
