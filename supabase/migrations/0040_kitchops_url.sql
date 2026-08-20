-- ============================================================================
-- KitchOps — set its production URL.
--
-- Confirmed by the platform owner: https://kitchops.acaciaco.com.mx, matching
-- the <app>.acaciaco.com.mx convention every other Base44 app in the registry
-- follows. 0039 deliberately seeded the row with url NULL rather than assuming
-- that pattern held, because this value becomes a link an operator clicks in
-- front of a client — the same two-step ctrlhq took in 0037/0038.
--
-- Already applied directly to production (2026-08-20) once the owner confirmed
-- the domain; this file brings the migration history back in sync with what is
-- actually deployed.
--
-- Idempotent: re-running sets the same value.
-- ============================================================================
update public.apps
  set url = 'https://kitchops.acaciaco.com.mx',
      updated_at = now()
  where id = 'kitchops';
