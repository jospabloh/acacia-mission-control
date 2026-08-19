-- ============================================================================
-- CtrlHQ (jospabloh/ctrlhq) — re-registration in the portfolio registry.
--
-- This is a NEW app, not a revival of the one 0036_remove_ctrlhq.sql deleted.
-- That earlier CtrlHQ (external_id 6a76631126f8a0987dd9be98) was a different
-- product the client passed on; its repo and Base44 app no longer exist. The
-- 'ctrlhq' id is being reused here for an unrelated, newly-built single-
-- tenant-per-business income/expense/payroll tool (see jospabloh/ctrlhq
-- CLAUDE.md) that has since been brought up to the acacia-app-standard 10
-- modules — Business tenant entity with billing_status, RLS, permission
-- registry, health endpoint, etc.
--
-- external_id is the LIVE Base44 app id for this new app (confirmed via the
-- Base44 MCP list_user_apps, not carried over from the old row).
--
-- url is left NULL — unlike the old row, this app's production domain has
-- not been confirmed live in this session; fill it in once jospabloh/ctrlhq
-- is actually deployed (a repurposed subdomain of acaciaco.com.mx, matching
-- the rest of ACACIA's own tools, is one option, but do not assume the old
-- ctrlhq.acaciaco.com.mx still points here — verify before reusing it).
--
-- field_map mirrors stockflow/puntos' shape (tenant = Business,
-- billing_status/license_plan/licensed_user_limit/trial_end_at/
-- license_expires_at) — see api/_lib/licenseControl.js's `ctrlhq` entry,
-- which is what the license-lifecycle cron and Licencias page actually read
-- at runtime; this config JSON documents the same shape for future adapter
-- work but is not itself consumed by adapters/base44.js today.
--
-- Idempotent: re-running updates the row in place.
-- ============================================================================
insert into public.apps (id, name, backend, external_id, category, url, status, config) values
  ('ctrlhq', 'CtrlHQ', 'base44', '6a7b5d0edb6b035ccae558f3', 'app', null, 'active',
   '{"license_entity":"Business","ticket_entity":"SupportTicket","ticket_message_entity":"SupportTicketMessage","tenant_field":"business_id","field_map":{
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
