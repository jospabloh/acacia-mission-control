-- ============================================================================
-- app_sessions: read-optimized copy of each app's end-user sessions, kept in the
-- bodega so the portfolio dashboard can show "N sesiones abiertas" per app with a
-- single query (no live bridge fan-out). One row = one login on one device.
--
--   Source of truth is each app's own AppSession entity; MC only mirrors it via
--   the acaciaControl bridge (sync/syncSessions.js). The detail view reads LIVE;
--   this table powers the cheap overview. Sessions idle > 24h are pruned by the
--   sync (considered ended). `revoked_at` reflects a MC-forced logout.
-- ============================================================================
create table public.app_sessions (
  id             uuid primary key default gen_random_uuid(),
  app_id         text not null references public.apps(id) on delete cascade,
  external_id    text not null,                          -- AppSession record id in the app
  user_email     text,
  user_name      text,
  device         text,                                   -- short user-agent label
  started_at     timestamptz,
  last_active_at timestamptz,                             -- moved by the client heartbeat
  revoked_at     timestamptz,                             -- set when MC forces a logout
  raw            jsonb not null default '{}'::jsonb,
  synced_at      timestamptz not null default now(),
  unique (app_id, external_id)
);

-- Overview aggregates by app; detail/pruning scan by recency.
create index app_sessions_app_active_idx on public.app_sessions (app_id, last_active_at desc);

-- RLS: mirror the operational tables — viewer reads, admin writes. The
-- service_role key used by the sync bypasses RLS, so writes land regardless;
-- the admin write policy keeps the model uniform.
alter table public.app_sessions enable row level security;

create policy app_sessions_read on public.app_sessions
  for select using (public.is_member_at_least('viewer'));
create policy app_sessions_write on public.app_sessions
  for all using (public.is_member_at_least('admin'))
  with check (public.is_member_at_least('admin'));
