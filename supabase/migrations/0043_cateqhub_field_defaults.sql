-- ============================================================================
-- ACACIA Mission Control — 0043_cateqhub_field_defaults
--
-- Teaches the licence sync how to read a tenant row that predates a licence
-- field, so the panel stops showing a real state as if the sync were broken.
--
-- The case, measured on production 2026-09-08: cateqhub's only parish was
-- created 2026-07-22, BEFORE `plan`, `license_status` and
-- `premium_period_end_at` were added to the Parish schema. A `.jsonc` default
-- applies when the record is created, not retroactively, so the bridge ships a
-- record whose keys are absent — `licenses.raw` for that row carries only
-- id/name/active/is_sample/created_date/admin_contact/created_by_id.
--
-- The app already resolves that absence, deliberately and in one place:
-- `getLicenseStatus()` in cateqhub's src/lib/premium.js reads a missing `plan`
-- as the permanent free tier (core features, 50-active-child cap, no Tutores),
-- and `create_child` / `add_guardian` branch the same way. So the app says
-- "Gratis, activa" while the bodega stored plan=null/status=null and
-- Licenses.jsx painted "—"/"—". Two surfaces, two answers, and the panel's
-- answer is indistinguishable from a failed sync.
--
-- `config.field_defaults` is the sibling of the `field_map` this row already
-- carries (0004, 0026): field_map says WHERE to read a logical field,
-- field_defaults says what it means when it is not there at all.
-- api/_lib/sync/licenseMapping.js applies it only when the record yields
-- nothing usable, so any real value still wins.
--
-- Why this and not a backfill of the parish row: a write fixes one row and
-- breaks again on the next schema addition, and this parish is a deliberate
-- demo with no licence — it should not be stamped with one, and it must not be
-- handed a 30-day trial by migrate_free_parishes_to_trial.
--
-- LOAD-BEARING: 'free' is deliberately NOT in cateqhub's
-- lifecycle.paidPlanValues (['premium'], api/_lib/licenseControl.js).
-- portfolioLifecycle.js selects rows by that list for status transitions and
-- customer-facing renewal email, so defaulting the plan INTO it would sweep a
-- demo tenant into the licence cron and mail its admin. No default is declared
-- for current_period_end for the same reason: renewal-reminders.js selects on
-- that column, and a null keeps this row unselected. Covered by
-- api/_lib/sync/licenseMapping.test.js.
-- ============================================================================

update public.apps
set config = coalesce(config, '{}'::jsonb) || jsonb_build_object(
  'field_defaults', jsonb_build_object('plan', 'free', 'status', 'active')
)
where id = 'cateqhub';
