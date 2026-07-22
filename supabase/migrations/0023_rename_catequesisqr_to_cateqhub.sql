-- ============================================================================
-- ACACIA Mission Control — 0023_rename_catequesisqr_to_cateqhub
-- Officialize the brand: "CatequesisQR" (0022) is now "CateqHub", hosted at
-- cateqhub.acaciaco.com.mx. No tenants/licenses/usage rows reference the old
-- id yet, so this is a clean rename rather than a data migration.
-- ============================================================================

delete from public.apps where id = 'catequesisqr';

insert into public.apps (id, name, backend, external_id, url, config) values
  ('cateqhub', 'CateqHub', 'base44', '6a5e79058ec761efd47be7fe',
   'https://cateqhub.acaciaco.com.mx',
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
