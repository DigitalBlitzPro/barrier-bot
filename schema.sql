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
