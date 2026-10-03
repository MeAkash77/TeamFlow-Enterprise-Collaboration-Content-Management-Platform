import { FormEvent, useState } from 'react';
import { api } from '../api';
import { useFetch } from '../hooks';

export default function Admin() {
  const users = useFetch<{ items: any[] }>('/users');
  const audit = useFetch<{ items: any[] }>('/audit');
  const hooks = useFetch<{ items: any[] }>('/webhook-endpoints');
  const deliveries = useFetch<{ items: any[] }>('/webhook-endpoints/deliveries');
  const [url, setUrl] = useState(''); const [secret, setSecret] = useState('');

  async function setRole(id: string, role: string) { await api(`/users/${id}/role`, { method: 'PATCH', body: { role } }); users.reload(); }
  async function addHook(e: FormEvent) {
    e.preventDefault();
    const r = await api<any>('/webhook-endpoints', { method: 'POST', body: { url, events: ['*'] } });
    setSecret(r.secret); setUrl(''); hooks.reload();
  }
  return (
    <>
      <h1>Administration</h1>
      <section className="panel"><h2>Users & roles</h2>
        <div className="scroll"><table><thead><tr><th>Name</th><th>Email</th><th>Role</th></tr></thead><tbody>
          {users.data?.items.map((u) => (<tr key={u.id}><td>{u.name}</td><td>{u.email}</td><td>
            <select aria-label={`Role for ${u.name}`} value={u.role} onChange={(e) => setRole(u.id, e.target.value)}>
              <option>viewer</option><option>editor</option><option>admin</option></select></td></tr>))}
        </tbody></table></div></section>

      <section className="panel"><h2>Outbound webhooks</h2>
        <form className="row gap" onSubmit={addHook}>
          <label className="grow"><span className="sr">Endpoint URL</span><input type="url" required placeholder="https://example.com/hooks/teamflow" value={url} onChange={(e) => setUrl(e.target.value)} /></label>
          <button className="primary">Add endpoint</button>
        </form>
        {secret && <p className="note">Signing secret (shown once): <code>{secret}</code></p>}
        <ul>{hooks.data?.items.map((h) => <li key={h.id}><code>{h.url}</code></li>)}</ul>
        <h3>Recent deliveries</h3>
        <div className="scroll"><table><thead><tr><th>Event</th><th>Status</th><th>Attempts</th><th>Last error</th></tr></thead><tbody>
          {deliveries.data?.items.map((d) => <tr key={d.id}><td>{d.event}</td><td>{d.status}</td><td>{d.attempts}</td><td>{d.last_error}</td></tr>)}
        </tbody></table></div></section>

      <section className="panel"><h2>Audit log <span className="muted">(Java service)</span></h2>
        {audit.error && <p className="error" role="alert">{audit.error}</p>}
        <div className="scroll"><table><thead><tr><th>When</th><th>Actor</th><th>Action</th><th>Entity</th><th>IP</th></tr></thead><tbody>
          {audit.data?.items.map((a) => <tr key={a.id}><td>{new Date(a.createdAt).toLocaleString()}</td><td>{a.actorEmail}</td><td>{a.action}</td><td>{a.entity} {a.entityId?.slice(0, 8)}</td><td>{a.ip}</td></tr>)}
        </tbody></table></div></section>
    </>
  );
}
