-- ============================================================================
-- Per-app email-log config for the follow-up STATUS read (via acaciaControl →
-- emails.status). Only the apps that actually keep an email log get a config;
-- the rest fall back to "sin seguimiento automático" in the UI.
--   flowfin / stockflow → EmailNotification keyed by family_id / business_id.
-- liuma tracks a single `last_reminder_sent` on the subscription (no log entity)
-- and puntos/rumbo have none — handled in the UI, not here.
-- ============================================================================
update public.apps
  set config = config || '{"email_log":{"entity":"EmailNotification","id_field":"family_id"}}'::jsonb
  where id = 'flowfin';
update public.apps
  set config = config || '{"email_log":{"entity":"EmailNotification","id_field":"business_id"}}'::jsonb
  where id = 'stockflow';
