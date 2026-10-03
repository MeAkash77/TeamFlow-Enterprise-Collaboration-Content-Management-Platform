import { Link } from 'react-router-dom';
import { ago } from '../api';
import { useFetch } from '../hooks';

const label: Record<string, string> = {
  'document.created': 'created', 'document.updated': 'edited', 'document.restored': 'restored a version of', 'document.submitted': 'submitted for review',
  'document.published': 'published', 'comment.created': 'commented on', 'approval.requested': 'requested approval for', 'approval.approved': 'approved',
  'approval.rejected': 'rejected', 'integration.synced': 'synced a repository',
};
export default function Activity() {
  const { data, error, loading, reload } = useFetch<{ items: any[] }>('/activity?limit=50');
  return (
    <>
      <h1>Activity</h1>
      {loading && <p className="muted" role="status">Loading…</p>}
      {error && <p className="error" role="alert">{error} <button className="link" onClick={reload}>Retry</button></p>}
      <ol className="feed">
        {data?.items.map((a) => (
          <li key={a.id}>
            <strong>{a.actor_name || 'System'}</strong> {label[a.type] || a.type}{' '}
            {a.document_id ? <Link to={`/docs/${a.document_id}`}>{a.document_title}</Link> : a.meta?.repo}
            {a.meta?.mentions?.length ? <span className="muted"> · mentioned {a.meta.mentions.map((m: string) => '@' + m).join(', ')}</span> : null}
            <time className="muted"> · {ago(a.created_at)}</time>
          </li>
        ))}
      </ol>
    </>
  );
}
