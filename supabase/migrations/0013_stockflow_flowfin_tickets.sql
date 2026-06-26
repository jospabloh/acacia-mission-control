-- ============================================================================
-- StockFlow + FlowFin now persist support tickets (SupportTicket +
-- SupportTicketMessage entities, deployed to Base44). Record that in the
-- registry config for accuracy. (Mission Control's ticket model lives in
-- api/_lib/ticketControl.js, which is the authoritative source; this is
-- documentation parity so the registry no longer claims StockFlow has none.)
-- 0011 had removed StockFlow's ticket_entity because it was false at the time.
-- ============================================================================
update public.apps
  set config = config || '{"ticket_entity":"SupportTicket","ticket_message_entity":"SupportTicketMessage"}'::jsonb
  where id in ('stockflow', 'flowfin');
