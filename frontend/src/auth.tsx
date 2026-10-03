import { createContext, useCallback, useContext, useEffect, useState, ReactNode } from 'react';
import { api, TOKEN_KEY, User } from './api';

interface Ctx { user: User | null; loading: boolean; login: (email: string, password: string) => Promise<void>; logout: () => void; setToken: (t: string) => Promise<void> }
const AuthCtx = createContext<Ctx>(null as unknown as Ctx);
export const useAuth = () => useContext(AuthCtx);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!localStorage.getItem(TOKEN_KEY)) { setUser(null); setLoading(false); return; }
    try { setUser((await api<{ user: User }>('/auth/me')).user); }
    catch { localStorage.removeItem(TOKEN_KEY); setUser(null); }
    setLoading(false);
  }, []);
  useEffect(() => { refresh(); }, [refresh]);

  const setToken = async (t: string) => { localStorage.setItem(TOKEN_KEY, t); await refresh(); };
  const login = async (email: string, password: string) => {
    const r = await api<{ token: string }>('/auth/login', { method: 'POST', body: { email, password } });
    await setToken(r.token);
  };
  const logout = () => { localStorage.removeItem(TOKEN_KEY); setUser(null); };
  return <AuthCtx.Provider value={{ user, loading, login, logout, setToken }}>{children}</AuthCtx.Provider>;
}
