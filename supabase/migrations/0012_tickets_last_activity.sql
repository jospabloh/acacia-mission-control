-- ============================================================================
-- tickets.last_activity_at — the app's real last-activity time (last_activity_at
-- / last_message_at / updated_date on the source SupportTicket), so the unified
-- inbox can sort by genuine recency. `updated_at` can't serve this: the
-- trg_tickets_touch BEFORE UPDATE trigger overwrites it with now() on every
-- resync, which would collapse the ordering to "last synced". This column is not
-- touched by the trigger.
-- ============================================================================
alter table public.tickets add column if not exists last_activity_at timestamptz;
create index if not exists tickets_last_activity_idx on public.tickets (app_id, last_activity_at desc);
