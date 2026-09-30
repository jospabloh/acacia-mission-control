-- ============================================================================
-- Sommel (jospabloh/sommel) — registration in the portfolio registry.
--
-- POS for wine bars (comandas, cobro, turnos, checador, inventario). Base44
-- backend, tenant = WineBar (User.tenant_id is the membership). The first
-- tenant is Vindima; the app is multi-tenant and self-serve.
--
-- external_id is the LIVE Base44 app id, `6ab41c2a89f592a0eca074d2`, read
-- from the app itself (not guessed).
--
-- url is set in this same migration, unlike the two-step kitchops/ctrlhq/
-- artiskids rows, because the domain is already proven: on 2026-09-29
-- https://sommel.acaciaco.com.mx answered 200 with this app's <title>
-- ("Sommel"), and the portfolio smoke suite passed against it (sommel repo,
-- smoke.yml run #1).
--
-- The bridge is live before this row: acaciaControl answers a signed call,
-- INGEST_HMAC_SECRET and ACACIA_APP_SLUG=sommel are set on the app. That is
-- the order the standard asks for, so the first sync logs no errors.
--
-- config: field_map names are exactly what Sommel's acaciaControl projects
-- for a WineBar (projectWineBar). usage_entities must be in its
-- USAGE_ENTITIES allowlist or the bridge returns null for them.
-- ticket_message_entity is null: SupportTicket has a single `body`, and the
-- bridge has no tickets.thread (see ticketControl.js `sommel`).
-- session_entity is set here directly, same reasoning as 0040/0045.
--
-- Idempotent: re-running updates the row in place.
-- ============================================================================
insert into public.apps (id, name, backend, external_id, category, url, status, config) values
  ('sommel', 'Sommel', 'base44', '6ab41c2a89f592a0eca074d2', 'app', 'https://sommel.acaciaco.com.mx', 'active',
   '{"license_entity":"WineBar","ticket_entity":"SupportTicket","ticket_message_entity":null,"tenant_field":"tenant_id","session_entity":"AppSession","usage_entities":["Order","Payment","Product","Shift","Attendance","User"],"field_map":{
     "tenant_external_id":"id","name":"name","plan":"plan","status":"billing_status",
     "trial_ends_at":"trial_end_at","current_period_end":"current_period_end"
   }}'::jsonb)
on conflict (id) do update set
  name        = excluded.name,
  backend     = excluded.backend,
  external_id = excluded.external_id,
  category    = excluded.category,
  url         = excluded.url,
  status      = excluded.status,
  config      = excluded.config,
  updated_at  = now();
