-- ============================================================================
-- Umbral (jospabloh/umbral) — registration in the portfolio registry.
--
-- !! APPLY ONLY AFTER Umbral's acaciaControl is DEPLOYED and INGEST_HMAC_SECRET
-- !! and ACACIA_APP_SLUG=umbral are SET ON THE APP AND READ BACK (Module 16).
-- !! Registering earlier makes the first sync log "app not reachable" /
-- !! "bad signature" for a bridge that does not exist yet.
--
-- Condominium management: access passes (AccessPass / AccessEvent), fees and
-- payments (Fee / Payment), community notices (Notice). Base44 backend, tenant =
-- Condominium; User.condominium_id (top-level field) is the membership and the
-- tenant admins are Users with role `condo_admin`.
--
-- external_id is the LIVE Base44 app id, `6ac6b6d5aaf0d858dd14a690`, taken from
-- the app's own audit (2026-10-13), not guessed.
--
-- url is NULL: no production domain has been proven yet (same two-step as
-- kitchops 0039 / ctrlhq 0037 / artiskids 0045-0046). Fill it in a follow-up
-- migration once the domain answers 200 with the app's <title>.
--
-- Bridge surface (acaciaControl): ping, licenses.list, license.set,
-- tickets.list, tickets.update (status only), tenants.contacts,
-- emails.sendFollowup, usage.summary, sessions.list, sessions.revoke. No
-- usage.byTenant, no emails.status, no audit/mirror blocks.
--
-- config: Condominium carries billing_status / trial_end_at plus the two NEW
-- fields license_plan and license_expires_at, so field_map points the plan at
-- license_plan and the period end at license_expires_at (the artiskids shape).
-- There is no owner-email key: sommel's and artiskids' rows carry none, owners
-- are resolved through tenants.contacts (condo_admin Users), not field_map.
-- ticket_message_entity is null: SupportTicket has a single `message` and the
-- bridge has no tickets.thread (see ticketControl.js `umbral`, thread: null).
-- session_entity is set here directly (not backfilled), same reasoning as 0040
-- and 0045. Entity name is `Session` (not AppSession as in sommel/artiskids).
-- usage_entities must be in the app's USAGE_ENTITIES allowlist or the bridge
-- returns null for them.
--
-- Idempotent: re-running updates the row in place.
-- ============================================================================
insert into public.apps (id, name, backend, external_id, category, url, status, config) values
  ('umbral', 'Umbral', 'base44', '6ac6b6d5aaf0d858dd14a690', 'app', null, 'active',
   '{"license_entity":"Condominium","ticket_entity":"SupportTicket","ticket_message_entity":null,"tenant_field":"condominium_id","session_entity":"Session","usage_entities":["Unit","AccessPass","AccessEvent","Payment","Fee","Notice","User","Condominium"],"field_map":{
     "tenant_external_id":"id","name":"name","plan":"license_plan","status":"billing_status",
     "trial_ends_at":"trial_end_at","current_period_end":"license_expires_at"
   }}'::jsonb)
on conflict (id) do update set
  name        = excluded.name,
  backend     = excluded.backend,
  external_id = excluded.external_id,
  category    = excluded.category,
  status      = excluded.status,
  config      = excluded.config,
  updated_at  = now();
