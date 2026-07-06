-- ============================================================================
-- Per-app session-entity config. Tells the sync + control which Base44 entity
-- holds the app's end-user sessions (created by the client heartbeat, revoked by
-- MC). Only apps that ship the AppSession entity + heartbeat get a config; the
-- rest render "sesiones no soportadas" in the UI and never hit the bridge.
--
-- Every registered Base44 app carries end-user auth, so all of them get the same
-- entity name, `AppSession` (puntos, rumbo, liuma, flowfin, stockflow, radar).
-- Non-Base44 apps (plink_fx external, sites/static) are left without a config.
-- ============================================================================
update public.apps
  set config = config || '{"session_entity":"AppSession"}'::jsonb
  where backend = 'base44';
