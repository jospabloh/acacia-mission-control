-- ============================================================================
-- CtrlHQ — fill in the real Base44 app id.
--
-- 0033 registered 'ctrlhq' with external_id NULL because at the time no Base44
-- app was known to exist for it. It does: confirmed live via the Base44 MCP
-- (list_user_apps) as app id 6a76631126f8a0987dd9be98, git_remote_source "s3"
-- (auto-syncs from jospabloh/CtrlHQ on push to main — its entity schemas were
-- already live before this migration, from the merged app-setup PR).
--
-- external_id alone does NOT enroll ctrlhq in the license-lifecycle cron — see
-- the companion change to api/_lib/licenseControl.js + api/_lib/messaging.js
-- in this same PR, and jospabloh/CtrlHQ's CLAUDE.md "License lifecycle"
-- section for the full three-part checklist (bridge secret / external_id /
-- these two per-app config maps).
--
-- Idempotent: re-running sets the same value.
-- ============================================================================
update public.apps
  set external_id = '6a76631126f8a0987dd9be98',
      updated_at = now()
  where id = 'ctrlhq';
