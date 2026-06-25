-- ============================================================================
-- ACACIA Mission Control — 0001_init
-- Central "bodega" (warehouse) + app registry + members + audit + RLS by role.
--
-- Model: ONE platform owner (ACACIA) operates many SaaS apps. The source of
-- truth for licenses/users/support lives in each app's own backend; Mission
-- Control keeps a synced, read-optimized copy here for cross-portfolio views.
--
-- Auth: Supabase Auth users are mapped to a Mission Control role in `members`
-- (owner | admin | viewer). RLS gates the client (anon key + user JWT).
-- Serverless functions in api/ use the service_role key, which bypasses RLS.
-- ============================================================================

create extension if not exists "pgcrypto";

-- ─── members: Mission Control operators ─────────────────────────────────────
-- Defined first: the role-helper SQL functions below reference this table, and
-- SQL-language functions are validated against existing relations at creation.
create table public.members (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  email      text not null,
  role       text not null default 'viewer' check (role in ('owner','admin','viewer')),
  created_at timestamptz not null default now()
);

-- ─── Role helpers ───────────────────────────────────────────────────────────
-- A Mission Control operator's role, derived from the `members` table. Returns
-- NULL for an authenticated user who is not a member (→ no access under RLS).
create or replace function public.current_member_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select role from public.members where user_id = auth.uid()
$$;

create or replace function public.is_member_at_least(min_role text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  -- rank: owner(3) > admin(2) > viewer(1)
  select coalesce(
    (case public.current_member_role()
       when 'owner' then 3 when 'admin' then 2 when 'viewer' then 1 else 0 end)
    >=
    (case min_role
       when 'owner' then 3 when 'admin' then 2 when 'viewer' then 1 else 99 end),
    false)
$$;

-- ─── apps: registry = source of truth for "what apps exist" ─────────────────
create table public.apps (
  id          text primary key,                       -- slug: 'puntos', 'rumbo'…
  name        text not null,
  backend     text not null check (backend in ('base44','supabase','external','static')),
  external_id text,                                    -- e.g. Base44 app id
  url         text,                                    -- production app URL
  status      text not null default 'active' check (status in ('active','paused','archived')),
  config      jsonb not null default '{}'::jsonb,      -- adapter config (entities map, fn names…)
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- ─── tenants: a customer/account within one app ─────────────────────────────
create table public.tenants (
  id          uuid primary key default gen_random_uuid(),
  app_id      text not null references public.apps(id) on delete cascade,
  external_id text not null,                           -- id in the app's backend
  name        text,
  status      text,
  plan        text,
  contact     jsonb not null default '{}'::jsonb,
  raw         jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (app_id, external_id)
);

-- ─── licenses: subscription/plan state per tenant ───────────────────────────
create table public.licenses (
  id                 uuid primary key default gen_random_uuid(),
  app_id             text not null references public.apps(id) on delete cascade,
  tenant_id          uuid references public.tenants(id) on delete set null,
  external_id        text not null,
  plan               text,
  status             text,                             -- trial | active | past_due | canceled…
  seats              integer,
  trial_ends_at      timestamptz,
  current_period_end timestamptz,
  raw                jsonb not null default '{}'::jsonb,
  synced_at          timestamptz not null default now(),
  unique (app_id, external_id)
);

-- ─── revenue_events: payments/renewals (Mercado Pago) ───────────────────────
create table public.revenue_events (
  id          uuid primary key default gen_random_uuid(),
  app_id      text references public.apps(id) on delete set null,
  tenant_id   uuid references public.tenants(id) on delete set null,
  provider    text not null default 'mercadopago',
  event_type  text not null,                           -- payment | refund | chargeback…
  amount_cents bigint not null default 0,
  currency    text not null default 'MXN',
  external_id text,                                    -- provider payment id (idempotency)
  occurred_at timestamptz not null default now(),
  raw         jsonb not null default '{}'::jsonb,
  unique (provider, external_id)
);

-- ─── tickets + messages: support parity (Fase 3) ────────────────────────────
create table public.tickets (
  id          uuid primary key default gen_random_uuid(),
  app_id      text not null references public.apps(id) on delete cascade,
  tenant_id   uuid references public.tenants(id) on delete set null,
  external_id text not null,
  subject     text,
  status      text,
  priority    text,
  requester   jsonb not null default '{}'::jsonb,
  raw         jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (app_id, external_id)
);

create table public.ticket_messages (
  id          uuid primary key default gen_random_uuid(),
  ticket_id   uuid not null references public.tickets(id) on delete cascade,
  external_id text,
  author      jsonb not null default '{}'::jsonb,
  body        text,
  direction   text check (direction in ('inbound','outbound')),
  created_at  timestamptz not null default now(),
  unique (ticket_id, external_id)
);

-- ─── usage_daily: per-tenant daily product metrics (Fase 2) ─────────────────
create table public.usage_daily (
  id        uuid primary key default gen_random_uuid(),
  app_id    text not null references public.apps(id) on delete cascade,
  tenant_id uuid references public.tenants(id) on delete set null,
  day       date not null,
  metric    text not null,
  value     numeric not null default 0,
  unique (app_id, tenant_id, day, metric)
);

-- ─── app_health: uptime/latency probes (Fase 5) ─────────────────────────────
create table public.app_health (
  id         uuid primary key default gen_random_uuid(),
  app_id     text not null references public.apps(id) on delete cascade,
  checked_at timestamptz not null default now(),
  status     text not null,                            -- ok | degraded | down
  latency_ms integer,
  detail     jsonb not null default '{}'::jsonb
);

-- ─── leads: CRM inbound (acaciaco-site form → Google Sheets → ingest) ────────
create table public.leads (
  id          uuid primary key default gen_random_uuid(),
  source      text not null default 'website',
  name        text,
  email       text,
  phone       text,
  app_interest text,
  message     text,
  status      text not null default 'new' check (status in ('new','contacted','qualified','won','lost')),
  raw         jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);

-- ─── alerts: operational alerts (Fase 5) ────────────────────────────────────
create table public.alerts (
  id          uuid primary key default gen_random_uuid(),
  app_id      text references public.apps(id) on delete cascade,
  severity    text not null default 'info' check (severity in ('info','warning','critical')),
  kind        text not null,
  title       text not null,
  detail      jsonb not null default '{}'::jsonb,
  status      text not null default 'open' check (status in ('open','acknowledged','resolved')),
  created_at  timestamptz not null default now(),
  resolved_at timestamptz
);

-- ─── announcements: portfolio comms (Fase 4) ────────────────────────────────
create table public.announcements (
  id           uuid primary key default gen_random_uuid(),
  title        text not null,
  body         text,
  audience     jsonb not null default '{}'::jsonb,     -- {apps:[], roles:[], tenants:[]}
  status       text not null default 'draft' check (status in ('draft','scheduled','sent','canceled')),
  scheduled_for timestamptz,
  sent_at      timestamptz,
  created_by   uuid references auth.users(id) on delete set null,
  created_at   timestamptz not null default now()
);

-- ─── audit_actions: every privileged write through Mission Control ──────────
create table public.audit_actions (
  id          uuid primary key default gen_random_uuid(),
  actor       uuid references auth.users(id) on delete set null,
  actor_email text,
  action      text not null,
  target_app  text,
  target_type text,
  target_id   text,
  payload     jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);

-- ─── Indexes ────────────────────────────────────────────────────────────────
create index on public.tenants (app_id);
create index on public.licenses (app_id);
create index on public.licenses (status);
create index on public.revenue_events (app_id, occurred_at);
create index on public.tickets (app_id, status);
create index on public.ticket_messages (ticket_id);
create index on public.usage_daily (app_id, day);
create index on public.app_health (app_id, checked_at);
create index on public.alerts (status, severity);
create index on public.audit_actions (created_at);

-- ─── updated_at trigger ─────────────────────────────────────────────────────
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;

create trigger trg_apps_touch    before update on public.apps    for each row execute function public.touch_updated_at();
create trigger trg_tenants_touch before update on public.tenants for each row execute function public.touch_updated_at();
create trigger trg_tickets_touch before update on public.tickets for each row execute function public.touch_updated_at();

-- ============================================================================
-- Row Level Security
--   owner  → full control (incl. members + danger zone)
--   admin  → read everything, write operational tables, NOT members/apps-delete
--   viewer → read-only
-- The service_role key (api/ serverless) bypasses RLS entirely.
-- ============================================================================
alter table public.members        enable row level security;
alter table public.apps           enable row level security;
alter table public.tenants        enable row level security;
alter table public.licenses       enable row level security;
alter table public.revenue_events enable row level security;
alter table public.tickets        enable row level security;
alter table public.ticket_messages enable row level security;
alter table public.usage_daily    enable row level security;
alter table public.app_health     enable row level security;
alter table public.leads          enable row level security;
alter table public.alerts         enable row level security;
alter table public.announcements  enable row level security;
alter table public.audit_actions  enable row level security;

-- members: anyone can read their own row; owners manage all rows.
create policy members_self_read on public.members
  for select using (user_id = auth.uid() or public.is_member_at_least('owner'));
create policy members_owner_all on public.members
  for all using (public.is_member_at_least('owner'))
  with check (public.is_member_at_least('owner'));

-- apps: viewers read; admins write rows; only owners may delete.
create policy apps_read on public.apps
  for select using (public.is_member_at_least('viewer'));
create policy apps_write_admin on public.apps
  for insert with check (public.is_member_at_least('admin'));
create policy apps_update_admin on public.apps
  for update using (public.is_member_at_least('admin'))
  with check (public.is_member_at_least('admin'));
create policy apps_delete_owner on public.apps
  for delete using (public.is_member_at_least('owner'));

-- Operational tables: viewer reads, admin writes. Applied uniformly.
do $$
declare t text;
begin
  foreach t in array array[
    'tenants','licenses','revenue_events','tickets','ticket_messages',
    'usage_daily','app_health','leads','alerts','announcements'
  ] loop
    execute format(
      'create policy %1$s_read on public.%1$s for select using (public.is_member_at_least(''viewer''));', t);
    execute format(
      'create policy %1$s_write on public.%1$s for all using (public.is_member_at_least(''admin'')) with check (public.is_member_at_least(''admin''));', t);
  end loop;
end $$;

-- audit_actions: admins+ may read; owners only may delete (tamper-resistant).
create policy audit_read on public.audit_actions
  for select using (public.is_member_at_least('admin'));
create policy audit_insert on public.audit_actions
  for insert with check (public.is_member_at_least('admin'));
create policy audit_delete_owner on public.audit_actions
  for delete using (public.is_member_at_least('owner'));
