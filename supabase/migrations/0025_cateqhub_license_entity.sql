-- ============================================================================
-- CateqHub never had a license_entity registered, unlike every other portfolio
-- app (see 0002/0004) — that's why syncLicensesForApp() has been silently
-- short-circuiting with "no license_entity in config" and the `tenants` table
-- (public.tenants) has zero rows for cateqhub, which is why no tenant shows up
-- in Mission Control's UI at all: tenants are only ever created as a side
-- effect of the license sync (api/_lib/sync/syncLicenses.js).
--
-- CateqHub has no separate license/business entity — Parish itself carries the
-- license fields (plan/trial_ends_at, added in asistencia-catecismo PR #8), the
-- same one-entity-is-both-tenant-and-license shape as puntos' Business. field_map
-- is mostly redundant with licenseMapping.js's CANDIDATES defaults (name/plan/
-- trial_ends_at already match), but explicit here for clarity and consistency
-- with 0004. No `status` field exists yet on Parish (only a plain `active`
-- boolean, not a trial/active/suspended string), so status is left unmapped —
-- it'll show null in the bodega until/unless a real status field is added.
-- ============================================================================
update public.apps
  set config = config || '{
    "license_entity": "Parish",
    "field_map": {
      "tenant_external_id": "id",
      "name": "name",
      "plan": "plan",
      "trial_ends_at": "trial_ends_at"
    }
  }'::jsonb
  where id = 'cateqhub';
