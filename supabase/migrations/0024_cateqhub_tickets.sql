-- ============================================================================
-- CateqHub now persists support tickets (SupportTicket + SupportTicketMessage
-- entities, deployed to Base44, same shape as puntos/stockflow/flowfin —
-- owner/tenant roles, rich thread metadata). Record that in the registry
-- config. Per-app field mapping lives in api/_lib/ticketControl.js.
--
-- Note: CateqHub's acaciaControl bridge function has been added to the app's
-- repo but the app has not yet had its INGEST_HMAC_SECRET provisioned
-- (`npx base44 secrets set`), so this config is not yet reachable — same
-- "registered, bridge not deployed" state noted in 0022/0023 for licensing.
-- ============================================================================
update public.apps
  set config = config || '{"ticket_entity":"SupportTicket","ticket_message_entity":"SupportTicketMessage"}'::jsonb
  where id = 'cateqhub';
