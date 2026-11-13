-- Vertragsmanagement: initial schema (PostgreSQL 16; also runs on PGlite)

create table if not exists suppliers (
  id            text primary key,
  name          text not null,
  city          text,
  country       text,
  legal_form    text,
  class         text not null check (class in ('A','B','C')),
  contact       jsonb not null default '{}',
  external_refs jsonb not null default '[]',
  apps          jsonb not null default '[]',
  kpi           jsonb not null default '{}',
  risk          jsonb not null default '{}',
  measures      text not null default '',
  price_history jsonb,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  version       integer not null default 1
);

create table if not exists contracts (
  id             text primary key,
  supplier_id    text not null references suppliers(id),
  parent_id      text references contracts(id),
  type           text not null,
  title          text not null,
  start_date     date,
  end_date       date,
  notice_months  integer not null default 0,
  notice_mode    text not null default 'laufzeitende',
  renewal_months integer not null default 0,
  annual_value   numeric not null default 0,
  currency       text not null default 'CHF',
  review_date    date,
  law            text,
  venue          text,
  status         text not null default 'aktiv',
  terminated_per date,
  document_path  text,
  note           text not null default '',
  owner          text,
  external_refs  jsonb not null default '[]',
  source         jsonb,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  version        integer not null default 1
);
create index if not exists contracts_supplier on contracts(supplier_id);

create table if not exists documents (
  id           text primary key,
  path         text not null,
  name         text not null,
  kind         text not null,
  sha256       text not null,
  size         integer not null,
  content_type text not null,
  layout       jsonb,
  case_id      text,
  contract_id  text,
  created_by   jsonb,
  created_at   timestamptz not null default now()
);

create table if not exists cases (
  id            text primary key,
  title         text not null,
  type          text not null,
  supplier_id   text references suppliers(id),
  supplier_name text not null,
  source        text not null,
  status        text not null,
  created_by    jsonb not null,
  fields        jsonb not null default '{}',
  clauses       jsonb not null default '[]',
  document_id   text,
  signed_document_id text,
  review        jsonb,
  due_date      date,
  contract_id   text,
  fixture       text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  version       integer not null default 1
);

create table if not exists deadline_decisions (
  key          text primary key,
  contract_id  text,
  decision     text not null,
  note         text not null default '',
  decided_by   jsonb not null,
  decided_at   timestamptz not null default now()
);

create table if not exists jobs (
  id          text primary key,
  kind        text not null,
  status      text not null,
  title       text not null,
  subject     jsonb not null default '{}',
  events      jsonb not null default '[]',
  result      jsonb,
  error       text,
  provider    text not null,
  created_by  jsonb,
  resolution  jsonb,
  created_at  timestamptz not null default now(),
  finished_at timestamptz
);

create table if not exists users (
  oid        text primary key,
  name       text not null,
  email      text,
  roles      jsonb not null default '[]',
  last_seen  timestamptz not null default now()
);

create table if not exists standards (
  contract_type text primary key,
  version       text not null,
  parsed        jsonb not null,
  updated_at    timestamptz not null default now()
);

-- Append-only, hash-chained audit log. The application role gets INSERT and
-- SELECT only (see 002_grants.sql for Azure).
create table if not exists audit_events (
  seq            bigserial primary key,
  id             text not null unique,
  at             timestamptz not null,
  actor          jsonb not null,
  action         text not null,
  target_type    text,
  target_id      text,
  summary        text not null,
  details        jsonb not null default '{}',
  ip             text,
  user_agent     text,
  correlation_id text,
  prev_hash      text not null,
  hash           text not null
);
create index if not exists audit_target on audit_events(target_type, target_id);
create index if not exists audit_at on audit_events(at);

create table if not exists notifications (
  id         text primary key,
  user_oid   text not null,
  email      text,
  subject    text not null,
  body       text not null,
  link       text,
  dedupe_key text unique,
  sent_via   text not null,
  created_at timestamptz not null default now(),
  read_at    timestamptz
);

create table if not exists events_outbox (
  id           text primary key,
  type         text not null,
  subject      text not null,
  data         jsonb not null,
  created_at   timestamptz not null default now(),
  delivered_at timestamptz,
  attempts     integer not null default 0,
  last_error   text
);

create table if not exists webhooks (
  id         text primary key,
  url        text not null,
  secret     text not null,
  events     jsonb not null default '["*"]',
  active     boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists webhook_deliveries (
  id          text primary key,
  webhook_id  text not null,
  event_id    text not null,
  status      integer,
  error       text,
  attempt     integer not null,
  at          timestamptz not null default now()
);

create table if not exists settings (
  key   text primary key,
  value jsonb not null
);

create table if not exists store_seen (
  path    text primary key,
  etag    text,
  seen_at timestamptz not null default now()
);

-- Reject updates and deletes on the audit log at the database level.
create or replace function audit_events_immutable() returns trigger as $$
begin
  raise exception 'audit_events is append-only';
end;
$$ language plpgsql;

drop trigger if exists audit_events_no_update on audit_events;
create trigger audit_events_no_update before update or delete on audit_events
  for each row execute function audit_events_immutable();
