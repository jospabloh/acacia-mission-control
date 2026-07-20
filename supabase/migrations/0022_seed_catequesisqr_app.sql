-- ============================================================================
-- ACACIA Mission Control — 0022_seed_catequesisqr_app
-- Register CatequesisQR (parish catechism attendance, Base44 app) in the app
-- registry so Mission Control can operate it alongside the rest of the
-- portfolio, using the same pattern as 0002/0015.
--
-- CatequesisQR's data model (source: jospabloh/asistencia-catecismo
-- base44/entities/*.jsonc) has no billing/license or support-ticket entity
-- yet — Parish/Group/Child/Attendance/Guardian only. This is a minimal
-- registration (tenant_field + usage_entities), mirroring how flowfin/stockflow
-- started out before their acaciaControl bridge and license model were built
-- out in later migrations. license_entity/ticket_entity can be added once
-- that bridge exists on the app side.
--
-- Idempotent: re-running updates the row in place.
-- ============================================================================

insert into public.apps (id, name, backend, external_id, url, config) values
  ('catequesisqr', 'CatequesisQR', 'base44', '6a5e79058ec761efd47be7fe',
   'https://catequesisqr.acaciaco.com.mx',
   '{
      "tenant_field": "parish_id",
      "usage_entities": ["Parish", "Child", "Attendance"]
    }'::jsonb)
on conflict (id) do update set
  name        = excluded.name,
  backend     = excluded.backend,
  external_id = excluded.external_id,
  url         = excluded.url,
  config      = excluded.config,
  updated_at  = now();
