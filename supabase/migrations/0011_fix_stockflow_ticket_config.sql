-- ============================================================================
-- Remove the misleading `ticket_entity` from StockFlow's registry config.
--
-- StockFlow has NO SupportTicket entity — its "support" is a fire-and-forget
-- email (notifySupportIssue), nothing is persisted. The 0002 seed claimed
-- ticket_entity:"SupportTicket", which is false (verified against
-- stockflow/base44/entities — no ticket/issue/feedback entity exists). FlowFin
-- correctly has none. Mission Control's ticket model (api/_lib/ticketControl.js)
-- only includes puntos/rumbo/liuma, so this is hygiene: keep the registry honest
-- so nothing ever tries to sync StockFlow tickets.
-- ============================================================================
update public.apps set config = config - 'ticket_entity' - 'ticket_message_entity'
where id = 'stockflow';
