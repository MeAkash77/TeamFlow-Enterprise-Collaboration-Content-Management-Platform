import { FormEvent, useEffect, useState } from 'react';
import { useAuth } from '../auth';
import { api } from '../api';

export default function Login() {
  const { login, setToken } = useAuth();
  const [mode, setMode] = useState<'in' | 'up'>('in');
  const [f, setF] = useState({ name: '', email: '', password: '' });
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => { // OAuth2 redirect lands here with #token=...
    const t = new URLSearchParams(location.hash.slice(1)).get('token');
    if (t) { history.replaceState(null, '', '/login'); setToken(t); }
  }, [setToken]);

  async function submit(e: FormEvent) {
    e.preventDefault(); setBusy(true); setErr('');
    try {
      if (mode === 'in') await login(f.email, f.password);
      else { const r = await api<{ token: string }>('/auth/register', { method: 'POST', body: f }); await setToken(r.token); }
    } catch (e: any) { setErr(e.message === 'invalid_credentials' ? 'Wrong email or password.' : e.message); }
    setBusy(false);
  }
  return (
    <div className="login">
      <section>
        <h1 className="brand big">Team<em>Flow</em></h1>
        <p className="lede">One place for documents, decisions and the code behind them.</p>
        <form onSubmit={submit} aria-describedby={err ? 'login-err' : undefined}>
          {mode === 'up' && <label>Name<input required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} autoComplete="name" /></label>}
          <label>Email<input type="email" required value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} autoComplete="email" /></label>
          <label>Password<input type="password" required minLength={8} value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} autoComplete={mode === 'in' ? 'current-password' : 'new-password'} /></label>
          <p id="login-err" className="error" role="alert">{err}</p>
          <button className="primary" disabled={busy}>{busy ? 'Please wait…' : mode === 'in' ? 'Sign in' : 'Create account'}</button>
          <a className="btn" href="/api/auth/github">Continue with GitHub</a>
        </form>
        <button className="link" onClick={() => setMode(mode === 'in' ? 'up' : 'in')}>{mode === 'in' ? 'Need an account? Register' : 'Have an account? Sign in'}</button>
        <p className="hint">Demo (after seeding): editor@teamflow.dev / Passw0rd!</p>
      </section>
    </div>
  );
}
