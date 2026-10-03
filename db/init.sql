create extension if not exists pgcrypto;

create table users (
  id uuid primary key default gen_random_uuid(),
  email text unique not null,
  name text not null,
  password_hash text,
  role text not null default 'viewer' check (role in ('viewer','editor','admin')),
  created_at timestamptz not null default now()
);

create table documents (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  body text not null default '',
  status text not null default 'draft' check (status in ('draft','in_review','approved','published')),
  owner_id uuid not null references users(id),
  current_version int not null default 1,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  search_vector tsvector generated always as (
    setweight(to_tsvector('english', coalesce(title,'')), 'A') ||
    setweight(to_tsvector('english', coalesce(body,'')), 'B')) stored
);
create index documents_search_idx on documents using gin (search_vector);
create index documents_status_updated_idx on documents (status, updated_at desc);

create table document_versions (
  document_id uuid not null references documents(id) on delete cascade,
  version int not null,
  title text not null,
  body text not null,
  author_id uuid not null references users(id),
  change_note text,
  created_at timestamptz not null default now(),
  primary key (document_id, version)
);

create table comments (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references documents(id) on delete cascade,
  author_id uuid not null references users(id),
  body text not null,
  created_at timestamptz not null default now()
);
create index comments_doc_idx on comments (document_id, created_at);

create table mentions (
  comment_id uuid not null references comments(id) on delete cascade,
  user_id uuid not null references users(id),
  primary key (comment_id, user_id)
);

create table approvals (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references documents(id) on delete cascade,
  version int not null,
  requested_by uuid not null references users(id),
  reviewer_id uuid not null references users(id),
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  comment text,
  created_at timestamptz not null default now(),
  decided_at timestamptz
);
create index approvals_reviewer_idx on approvals (reviewer_id, status);

create table activity (
  id bigserial primary key,
  actor_id uuid references users(id),
  type text not null,
  document_id uuid references documents(id) on delete set null,
  meta jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index activity_created_idx on activity (created_at desc);

-- GitHub integration
create table integrations (
  id uuid primary key default gen_random_uuid(),
  provider text not null default 'github',
  repo text not null,
  token_enc text not null,            -- AES-256-GCM encrypted PAT
  webhook_secret text not null,
  default_branch text,
  last_synced_at timestamptz,
  created_by uuid references users(id),
  created_at timestamptz not null default now()
);
create table repo_events (
  id uuid primary key default gen_random_uuid(),
  integration_id uuid not null references integrations(id) on delete cascade,
  kind text not null check (kind in ('commit','pr')),
  external_id text not null,
  title text not null,
  url text,
  author text,
  state text,
  occurred_at timestamptz,
  unique (integration_id, kind, external_id)
);
create table document_links (
  document_id uuid not null references documents(id) on delete cascade,
  repo_event_id uuid not null references repo_events(id) on delete cascade,
  primary key (document_id, repo_event_id)
);

-- Outbound webhooks (outbox + retry)
create table webhook_endpoints (
  id uuid primary key default gen_random_uuid(),
  url text not null,
  secret text not null,
  events text[] not null default '{*}',
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create table webhook_deliveries (
  id uuid primary key default gen_random_uuid(),
  endpoint_id uuid not null references webhook_endpoints(id) on delete cascade,
  event text not null,
  payload jsonb not null,
  idempotency_key text not null unique,
  status text not null default 'pending' check (status in ('pending','delivered','failed')),
  attempts int not null default 0,
  last_error text,
  next_attempt_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create index webhook_due_idx on webhook_deliveries (next_attempt_at) where status = 'pending';

create table idempotency_keys (
  key text not null,
  user_id uuid not null,
  status int not null,
  body jsonb not null,
  created_at timestamptz not null default now(),
  primary key (key, user_id)
);
