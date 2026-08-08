-- ============================================================================
-- CtrlHQ — set its production URL.
--
-- Unlike the rest of the portfolio (stockflow.acacia.co, etc.), CtrlHQ's app
-- domain is a subdomain of acaciaco.com.mx rather than acacia.co — that's the
-- domain the platform owner reserved for it, not a mistake to reconcile with
-- the other apps' pattern.
--
-- Idempotent: re-running sets the same value.
-- ============================================================================
update public.apps
  set url = 'https://ctrlhq.acaciaco.com.mx',
      updated_at = now()
  where id = 'ctrlhq';
