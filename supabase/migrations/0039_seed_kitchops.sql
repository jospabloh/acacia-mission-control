-- ============================================================================
-- KitchOps (jospabloh/kitchops) — registration in the portfolio registry.
--
-- Back-office control for independent restaurants: gastos, cortes de las
-- plataformas de delivery, inventario, alertas, and a WhatsApp agent that
-- captures all of it from a phone. Base44 backend, multi-tenant via a
-- `Business` tenant entity + `Membership`, brought up to the full
-- acacia-app-standard 10 modules in 2026-08.
--
-- external_id is the LIVE Base44 app id, confirmed in this session via the
-- Base44 MCP (list_user_apps → KitchOps → 6a83b727bb6cfcaac263ab0d), not
-- guessed from the repo.
--
-- url is deliberately left NULL. The app is deployed on Base44 but its
-- customer-facing domain has not been confirmed in this session, and a wrong
-- URL here is worse than none: the Portafolio page turns it into a link an
-- operator clicks in front of a client. Fill it in with a follow-up migration
-- once the domain is verified — that is exactly how ctrlhq was handled
-- (0037 seeded it null, 0038 set it after the platform owner confirmed).
--
-- field_map mirrors stockflow/puntos/ctrlhq's shape (tenant = Business, with
-- billing_status/license_plan/licensed_user_limit/trial_end_at/
-- license_expires_at on that same entity). What the license-lifecycle cron and
-- the Licencias page actually read at runtime is api/_lib/licenseControl.js's
-- `kitchops` entry; this config JSON documents the same shape for adapter work
-- and is what the ticket bridge's entity names come from.
--
-- session_entity is set here rather than inherited: 0021 backfilled every
-- base44-backed app that existed at the time, and a row inserted afterwards
-- would silently miss it and render "sesiones no soportadas" despite KitchOps
-- shipping AppSession + the heartbeat.
--
-- Idempotent: re-running updates the row in place.
-- ============================================================================
insert into public.apps (id, name, backend, external_id, category, url, status, config) values
  ('kitchops', 'KitchOps', 'base44', '6a83b727bb6cfcaac263ab0d', 'app', null, 'active',
   '{"license_entity":"Business","ticket_entity":"SupportTicket","ticket_message_entity":"SupportTicketMessage","tenant_field":"business_id","session_entity":"AppSession","usage_entities":["Gasto","IngresoPlataforma","InventarioItem"],"field_map":{
     "tenant_external_id":"id","name":"name","plan":"license_plan","status":"billing_status",
     "seats":"licensed_user_limit","trial_ends_at":"trial_end_at","current_period_end":"license_expires_at"
   }}'::jsonb)
on conflict (id) do update set
  name        = excluded.name,
  backend     = excluded.backend,
  external_id = excluded.external_id,
  category    = excluded.category,
  status      = excluded.status,
  config      = excluded.config,
  updated_at  = now();
