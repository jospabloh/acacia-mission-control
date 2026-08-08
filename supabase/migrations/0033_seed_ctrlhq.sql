-- ============================================================================
-- CtrlHQ (jospabloh/CtrlHQ) — alta en el registro del portafolio.
--
-- App Base44 multi-tenant recién productivizada (RLS, invite codes, permisos,
-- licenciamiento, tickets — ver CtrlHQ/CLAUDE.md). Estructuralmente igual a
-- StockFlow: tenant = entidad Business, mismos nombres de campo de licencia
-- (billing_status, license_plan, licensed_user_limit, trial_end_at,
-- license_expires_at), así que field_map/tenant_field se copian de esa fila.
--
-- external_id (Base44 app id) queda NULL a propósito: el repo todavía no
-- corrió `base44 link` en este entorno, así que no hay un app id real que
-- registrar. Completar con el id real (ver base44/.app.jsonc tras `base44
-- link`, o `list_user_apps` vía el MCP de Base44) antes de que
-- api/cron/license-lifecycle.js o sync-licenses puedan operar sobre esta fila
-- — con external_id NULL esos jobs deben saltarla sin romper el resto del
-- portafolio (confirmar ese comportamiento, no asumirlo).
--
-- Idempotente: re-ejecutarla actualiza la fila en su lugar.
-- ============================================================================
insert into public.apps (id, name, backend, external_id, category, url, status, config) values
  ('ctrlhq', 'CtrlHQ', 'base44', null, 'app', null, 'active',
   '{"license_entity":"Business","ticket_entity":"SupportTicket","ticket_message_entity":"SupportTicketMessage","tenant_field":"business_id","field_map":{
     "tenant_external_id":"id","name":"name","plan":"license_plan","status":"billing_status",
     "seats":"licensed_user_limit","trial_ends_at":"trial_end_at","current_period_end":"license_expires_at"
   }}'::jsonb)
on conflict (id) do update set
  name        = excluded.name,
  backend     = excluded.backend,
  category    = excluded.category,
  status      = excluded.status,
  config      = excluded.config,
  updated_at  = now();
