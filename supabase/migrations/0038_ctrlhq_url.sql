-- ============================================================================
-- CtrlHQ — set its production URL.
--
-- Confirmed by the platform owner: https://ctrlhq.acaciaco.com.mx — the same
-- domain the OLD (deleted) CtrlHQ used, now repointed at this new app. The
-- Base44-assigned default (https://smart-angelic-flow-ledger.base44.app,
-- confirmed live via `base44 site deploy` in this session) still serves the
-- same app; this custom domain is what the portfolio should link to.
--
-- Already applied directly to production (2026-08-19) at the platform
-- owner's request, alongside 0037 — this file brings the migration history
-- back in sync with what's actually deployed.
--
-- Idempotent: re-running sets the same value.
-- ============================================================================
update public.apps
  set url = 'https://ctrlhq.acaciaco.com.mx',
      updated_at = now()
  where id = 'ctrlhq';
