-- ============================================================================
-- ArtisKids — set its production URL.
--
-- 0045 seeded the row with url NULL, same two-step as kitchops (0039/0040) and
-- ctrlhq (0037/0038): this value becomes a link an operator clicks in front of
-- a client, so it waits until the domain is proven, not assumed.
--
-- Proven 2026-09-23: https://artiskids.acaciaco.com.mx answers 200 and serves
-- this app's own <title> ("ArtisKids — la cápsula del tiempo de sus dibujos"),
-- the platform owner published it there, and the first sync over the bridge
-- succeeded the same day.
--
-- Idempotent: re-running sets the same value.
-- ============================================================================
update public.apps
  set url = 'https://artiskids.acaciaco.com.mx',
      updated_at = now()
  where id = 'artiskids';
