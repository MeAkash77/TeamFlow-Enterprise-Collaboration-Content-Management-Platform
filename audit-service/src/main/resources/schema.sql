create table if not exists audit_logs (
  id bigserial primary key,
  action text not null,
  entity text not null,
  entity_id text,
  actor_id text,
  actor_email text,
  ip text,
  request_id text,
  detail jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index if not exists audit_logs_created_idx on audit_logs (created_at desc);
create index if not exists audit_logs_entity_idx on audit_logs (entity, entity_id);
