-- ============================================================================
-- ACACIA Mission Control — 0014_ticket_sla_push
-- Real-time ticket push + ITIL SLA tracking.
--
-- Until now `tickets` was populated ONLY by the daily/on-demand pull sync, so a
-- new ticket appeared in Mission Control with up to a day of lag (or when an
-- operator hit "sincronizar"). This migration adds the columns the new push
-- path (api/ingest/ticket.js) writes so a ticket raised by a customer is
-- reflected here within seconds, with its SLA clock anchored to the customer's
-- own creation instant.
-- ============================================================================

alter table public.tickets
  -- When the CUSTOMER created the ticket in the app (the app's created_date).
  -- The SLA clock runs from here, not from when MC ingested it.
  add column if not exists customer_created_at         timestamptz,
  -- ITIL SLA due times, derived from customer_created_at + priority (api/_lib/sla.js).
  add column if not exists sla_first_response_due_at    timestamptz,
  add column if not exists sla_resolve_due_at           timestamptz,
  -- How this row reached the bodega: 'push' (real-time ingest) | 'sync' (pull).
  add column if not exists source                        text,
  -- When the new-ticket notification fan-out (email/…) ran. Idempotency guard so
  -- a retried push never re-notifies.
  add column if not exists notified_at                   timestamptz;

-- Inbox queries sort/filter by SLA breach and recency.
create index if not exists tickets_sla_resolve_due_idx on public.tickets (sla_resolve_due_at);
create index if not exists tickets_customer_created_idx on public.tickets (customer_created_at);

-- Realtime: the Support page subscribes to `tickets` so a pushed ticket appears
-- live, with no manual sync. New tables aren't in the realtime publication by
-- default — add it (idempotently). RLS still applies to realtime, so only
-- Mission Control members receive the changes.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'tickets'
  ) then
    execute 'alter publication supabase_realtime add table public.tickets';
  end if;
end $$;
