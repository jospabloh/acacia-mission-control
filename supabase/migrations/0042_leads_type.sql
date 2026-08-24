-- ============================================================================
-- Soporte a Apps (Fase 1, docs/superpowers/specs/2026-08-24-soporte-apps-design.md)
-- — a visitor on acaciaco.com.mx can ask for support/an improvement on an app,
-- or propose a new app idea, without ever entering an app. Lands in `leads`
-- (NOT `tickets` — a ticket fabricated with no real SupportTicket behind it in
-- the app would break the moment an operator replied to it from the panel,
-- since a reply always writes back to the app's own backend via its
-- acaciaControl bridge; see the spec for the full reasoning).
--
-- `type` distinguishes this from an ordinary sales lead (`null`, the table's
-- original and only meaning until now).
-- ============================================================================

alter table public.leads
  add column if not exists type text check (type in ('soporte', 'mejora', 'idea'));

create index if not exists leads_type on public.leads (type);
