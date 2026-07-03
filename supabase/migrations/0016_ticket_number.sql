-- ============================================================================
-- ACACIA Mission Control — 0016_ticket_number
-- Human-readable ticket folio (ITSM).
--
-- Until now a ticket was referenced only by `external_id` — the app backend's
-- technical id (a Base44 hash like `6a470bb06aa3dce4357d72ed`). That is a stable
-- key but terrible UX: you can't dictate it on a call or print it on an SLA.
-- The apps now assign a readable folio server-side (e.g. rumbo → RUM-000001);
-- Mission Control stores it here and leads with it in the alert email + inbox.
-- `external_id` stays the technical key the bridge updates key off; this is the
-- customer/operator-facing reference. Null for rows created before the change.
-- ============================================================================
alter table public.tickets
  add column if not exists ticket_number text;

-- Inbox lookups / "find ticket RUM-000123".
create index if not exists tickets_ticket_number_idx on public.tickets (ticket_number);
