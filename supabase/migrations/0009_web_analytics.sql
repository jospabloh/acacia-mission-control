-- ============================================================================
-- First-party, privacy-friendly web analytics. The acaciaco.com.mx site (and its
-- /freeware/* + /baristop pages) sends a lightweight pixel to MC's /api/track,
-- which records a pageview here. No PII: `visitor` is a daily-salted, one-way
-- hash (rotates each day, not reversible, not cross-day linkable). Mission
-- Control aggregates this into the Freeware/Sitios KPIs. Free, ours, no 3rd party.
-- ============================================================================
create table if not exists public.web_events (
  id        bigint generated always as identity primary key,
  ts        timestamptz not null default now(),
  day       date not null default ((now() at time zone 'utc')::date),
  host      text,
  path      text not null,
  ref       text,
  visitor   text  -- daily-salted hash; no raw IP/UA stored
);
create index if not exists web_events_day_idx  on public.web_events (day);
create index if not exists web_events_path_idx on public.web_events (path);

alter table public.web_events enable row level security;
-- Members read (for the dashboard KPIs); writes happen via the service_role key
-- in /api/track (bypasses RLS). No anon/insert policy on purpose.
drop policy if exists web_events_read on public.web_events;
create policy web_events_read on public.web_events
  for select using (public.is_member_at_least('viewer'));
