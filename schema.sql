-- Barrier Bot database. Everything lives in the "barrier" schema so it can share a Supabase project
-- with other tools without touching their tables. This file mirrors every migration applied.

create schema if not exists barrier;

-- One row per Blitz Barrier client (and per prospect who asked for a Territory Scan).
create table if not exists barrier.clients (
  id                  bigserial primary key,
  ghl_contact_id      text not null unique,          -- the contact in Digital Blitz's GHL account
  status              text not null default 'prospect'
                      check (status in ('prospect','purchased','onboarded','active','paused','cancelled')),
  company             text,
  owner_name          text,
  phone               text,
  email               text,
  website             text,
  website_platform    text,
  gbp_url             text,
  registered_city     text,                          -- the exclusive city
  service_cities      text[] not null default '{}',
  services_offered    text[] not null default '{}',
  growth_services     text[] not null default '{}',
  job_software        text,
  has_phone_system    boolean,
  competitors         text,
  brand_voice         text,
  guarantees          text,
  approved_safety_wording text,
  review_requests_now text,
  review_tool_name    text,
  ask_commercial      boolean,
  legal_name          text,
  ein                 text,
  business_type       text,
  street_address      text,
  city                text,
  state               text,
  postal_code         text,
  plan                text,                          -- standard | new_website | ads_rate
  humor               text not null default 'full' check (humor in ('none','light','full')),
  start_date          date,
  ghl_location_id     text,                          -- the client's own sub-account, once created
  raw_fields          jsonb not null default '{}',   -- every field GHL sent, for anything not mapped yet
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

-- Every webhook GHL sends, kept as received. The handler reads from here, so nothing is lost if a job fails.
create table if not exists barrier.events (
  id             bigserial primary key,
  path           text not null,                      -- e.g. client/create
  ghl_contact_id text,
  ghl_location_id text,
  payload        jsonb not null,
  received_at    timestamptz not null default now()
);

-- The job queue. One row per piece of work. The worker claims the oldest due job with SKIP LOCKED.
create table if not exists barrier.jobs (
  id           bigserial primary key,
  type         text not null,                        -- e.g. territory_scan, baseline_audit
  client_id    bigint references barrier.clients(id),
  event_id     bigint references barrier.events(id),
  dedupe_key   text,                                 -- same type + key while pending = one job
  status       text not null default 'pending' check (status in ('pending','running','done','failed')),
  run_after    timestamptz not null default now(),
  attempts     int not null default 0,
  max_attempts int not null default 3,
  result       jsonb,
  error        text,
  created_at   timestamptz not null default now(),
  started_at   timestamptz,
  finished_at  timestamptz
);
create unique index if not exists jobs_one_pending
  on barrier.jobs (type, dedupe_key) where status in ('pending','running') and dedupe_key is not null;
create index if not exists jobs_due on barrier.jobs (run_after) where status = 'pending';

-- Software API keys from the Software Connect form. Stored encrypted (AES-256-GCM, key in BARRIER_SECRETS_KEY),
-- never in GHL and never in plain text.
create table if not exists barrier.client_connections (
  client_id   bigint primary key references barrier.clients(id),
  software    text not null,
  secret_enc  text not null,                         -- iv.tag.ciphertext, base64
  status      text not null default 'untested' check (status in ('untested','connected','failed')),
  updated_at  timestamptz not null default now()
);

-- Money spent per client per month (Anthropic, DataForSEO), so cost per client is visible.
create table if not exists barrier.spend (
  id         bigserial primary key,
  client_id  bigint references barrier.clients(id),
  job_id     bigint references barrier.jobs(id),
  vendor     text not null,
  usd        numeric(10,4) not null,
  at         timestamptz not null default now()
);

-- Not exposed to the public API: only the bot's direct database connection uses these tables.
revoke all on all tables in schema barrier from anon, authenticated;
revoke usage on schema barrier from anon, authenticated;

-- Row Level Security on, with no policies: the API roles see nothing. The bot connects as the table owner, which RLS does not restrict.
alter table barrier.clients enable row level security;
alter table barrier.events enable row level security;
alter table barrier.jobs enable row level security;
alter table barrier.client_connections enable row level security;
alter table barrier.spend enable row level security;

-- A login just for Barrier Bot (migration barrier_bot_role). Kenny sets its password in the Supabase SQL Editor;
-- it is never stored in this repo. Connection string: postgresql://barrier_bot.<project-ref>:<password>@<pooler-host>:5432/postgres
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'barrier_bot') then create role barrier_bot login noinherit; end if;
end $$;
grant usage on schema barrier to barrier_bot;
grant select, insert, update, delete on all tables in schema barrier to barrier_bot;
grant usage, select on all sequences in schema barrier to barrier_bot;
alter default privileges in schema barrier grant select, insert, update, delete on tables to barrier_bot;
alter default privileges in schema barrier grant usage, select on sequences to barrier_bot;
create policy barrier_bot_all on barrier.clients for all to barrier_bot using (true) with check (true);
create policy barrier_bot_all on barrier.events for all to barrier_bot using (true) with check (true);
create policy barrier_bot_all on barrier.jobs for all to barrier_bot using (true) with check (true);
create policy barrier_bot_all on barrier.client_connections for all to barrier_bot using (true) with check (true);
create policy barrier_bot_all on barrier.spend for all to barrier_bot using (true) with check (true);

-- Territory Scans (migration barrier_scans). The token is the private link texted to the prospect.
create table if not exists barrier.scans (
  id         bigserial primary key,
  token      text not null unique,
  client_id  bigint references barrier.clients(id),
  job_id     bigint references barrier.jobs(id),
  data       jsonb not null,
  created_at timestamptz not null default now()
);
alter table barrier.scans enable row level security;
grant select, insert, update, delete on barrier.scans to barrier_bot;
grant usage, select on sequence barrier.scans_id_seq to barrier_bot;
create policy barrier_bot_all on barrier.scans for all to barrier_bot using (true) with check (true);

-- Monthly work (migration barrier_monthly_work, 2026-11-28).
alter table barrier.clients add column if not exists activated_at timestamptz;        -- kickoff done (C5b); month cycles count from here
alter table barrier.clients add column if not exists dash_token text unique;           -- private link to the client's dashboard
alter table barrier.clients add column if not exists ghl_location_token_enc text;      -- the client sub-account's Private Integration token, encrypted
alter table barrier.clients add column if not exists website_login_enc text;           -- WordPress user + application password, encrypted

-- Map, AI and review measurements: one baseline after purchase, then one per month.
create table if not exists barrier.snapshots (
  id          bigserial primary key,
  client_id   bigint not null references barrier.clients(id),
  kind        text not null check (kind in ('baseline','monthly')),
  cycle       int not null default 0,
  grid_pct    int,
  avg_rank    numeric(5,1),
  ai_hits     int,
  ai_asked    int,
  reviews     int,
  rating      numeric(3,2),
  data        jsonb not null,
  created_at  timestamptz not null default now()
);
create index if not exists snapshots_client on barrier.snapshots (client_id, created_at desc);

-- Everything the bot makes for a client: Google posts, local pages, articles, the month-1 site audit.
create table if not exists barrier.work_items (
  id            bigserial primary key,
  client_id     bigint not null references barrier.clients(id),
  cycle         int not null default 0,
  kind          text not null check (kind in ('gbp_post','local_page','article','site_audit')),
  status        text not null default 'draft' check (status in ('draft','ready','scheduled','published','held','failed')),
  title         text,
  body          jsonb not null default '{}',
  token         text unique,                 -- private preview link
  scheduled_for timestamptz,
  published_at  timestamptz,
  external_id   text,
  error         text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists work_client_cycle on barrier.work_items (client_id, cycle, kind);

-- Job photos techs text in (template "Tech Photo Intake").
create table if not exists barrier.photos (
  id              bigserial primary key,
  client_id       bigint references barrier.clients(id),
  ghl_location_id text,
  url             text not null,
  tech            text,
  note            text,
  used_in         bigint references barrier.work_items(id),
  received_at     timestamptz not null default now()
);

-- Review engine events from the client sub-accounts (asked, done, do not ask, negative-review approval).
create table if not exists barrier.review_events (
  id              bigserial primary key,
  client_id       bigint references barrier.clients(id),
  ghl_location_id text,
  ghl_contact_id  text,
  tech            text,
  kind            text not null check (kind in ('asked','done','do_not_ask','approval')),
  data            jsonb not null default '{}',
  at              timestamptz not null default now()
);
create index if not exists review_events_client on barrier.review_events (client_id, at);

do $$ declare t text; begin
  foreach t in array array['snapshots','work_items','photos','review_events'] loop
    execute format('alter table barrier.%I enable row level security', t);
    execute format('grant select, insert, update, delete on barrier.%I to barrier_bot', t);
    execute format('grant usage, select on sequence barrier.%I_id_seq to barrier_bot', t);
    execute format('create policy barrier_bot_all on barrier.%I for all to barrier_bot using (true) with check (true)', t);
  end loop;
end $$;
revoke all on all tables in schema barrier from anon, authenticated;
