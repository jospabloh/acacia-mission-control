-- ============================================================================
-- ArtisKids (jospabloh/artiskids) — registration in the portfolio registry.
--
-- Family "art capsule": children's drawings get uploaded, family members
-- comment/react to them. Base44 backend, tenant = Family (Module 18-retired
-- shape: User.family_id/family_role ARE the membership, no separate
-- Membership entity). Brought up through Phase 4 of its own CLAUDE.md
-- rollout as of this migration — Phase 3's backend functions and Phase 4's
-- frontend are both code-complete but NOT YET DEPLOYED to the live Base44
-- app (no secrets set, no functions push). This registry row can exist
-- before that deploy: the sync cron and the panel simply get "app not
-- reachable" from acaciaControl until the bridge is actually live, same as
-- any newly-registered app before its first successful sync.
--
-- external_id is the LIVE Base44 app id, confirmed against the app itself in
-- Phase 0 of the artiskids rollout (`6aaeda94a9028c3f2e96b9e5`) — not guessed.
--
-- url is deliberately left NULL, same reasoning as kitchops (0039) and ctrlhq
-- (0037): the app has no confirmed production domain yet (will be
-- artiskids.acaciaco.com.mx per the frozen decision in its own CLAUDE.md,
-- filled in by a follow-up migration at cutover, same two-step as those apps).
--
-- config mirrors stockflow/kitchops' shape (tenant = Family, with
-- billing_status/license_plan/trial_end_at/license_expires_at on that same
-- entity). What the license-lifecycle cron and the Licencias page actually
-- read at runtime is api/_lib/licenseControl.js's `artiskids` entry (added in
-- the same commit as this migration); this config JSON documents the same
-- shape for adapter work. ticket_message_entity is null and
-- api/_lib/ticketControl.js's own `artiskids` entry sets `thread: null` to
-- match — SupportTicket carries a single `message` field, no separate thread
-- entity exists yet (see that file's comment for why).
--
-- session_entity set here directly (not backfilled) — same reasoning 0040's
-- kitchops comment gives: a row inserted after 0021's backfill would silently
-- miss it and render "sesiones no soportadas" despite artiskids shipping
-- AppSession + the Module 20 heartbeat.
--
-- Idempotent: re-running updates the row in place.
-- ============================================================================
insert into public.apps (id, name, backend, external_id, category, url, status, config) values
  ('artiskids', 'ArtisKids', 'base44', '6aaeda94a9028c3f2e96b9e5', 'app', null, 'active',
   '{"license_entity":"Family","ticket_entity":"SupportTicket","ticket_message_entity":null,"tenant_field":"family_id","session_entity":"AppSession","usage_entities":["Drawing","Child","Comment","Reaction"],"field_map":{
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
