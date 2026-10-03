export type Role = 'viewer' | 'editor' | 'admin';
export interface User { id: string; email: string; name: string; role: Role }
export interface Doc { id: string; title: string; body: string; status: string; current_version: number; owner_id: string; owner_name: string; updated_at: string; snippet?: string }

export class ApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
export const TOKEN_KEY = 'tf_token';

export async function api<T = any>(path: string, opts: { method?: string; body?: unknown; idempotent?: boolean } = {}): Promise<T> {
  const token = localStorage.getItem(TOKEN_KEY);
  const res = await fetch('/api' + path, {
    method: opts.method || 'GET',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(opts.idempotent ? { 'Idempotency-Key': crypto.randomUUID() } : {}),
    },
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, data.error || res.statusText);
  return data as T;
}
export const can = (u: User | null, min: Role) => !!u && ({ viewer: 1, editor: 2, admin: 3 })[u.role] >= ({ viewer: 1, editor: 2, admin: 3 })[min];
export const ago = (iso: string) => {
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return new Date(iso).toLocaleDateString();
};
