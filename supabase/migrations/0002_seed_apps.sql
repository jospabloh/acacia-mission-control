-- ============================================================================
-- ACACIA Mission Control — 0002_seed_apps
-- Seed the app registry with the current portfolio: 5 Base44 apps + plink_fx.
-- App ids are the canonical Base44 app ids (source: Base44 list_user_apps).
-- Idempotent: re-running updates the registry row in place.
-- ============================================================================

insert into public.apps (id, name, backend, external_id, url, config) values
  ('puntos', 'Puntos+', 'base44', '696e7fdd7889892fe40868b7',
   'https://puntos.acacia.co',
   '{"license_entity":"Business","ticket_entity":"SupportTicket","ticket_message_entity":"SupportTicketMessage","tenant_field":"id"}'::jsonb),

  ('rumbo', 'Rumbo', 'base44', '6a15eceffe8dbf6602fa6c35',
   'https://rumbo.acacia.co',
   '{"license_entity":"TenantLicense","ticket_entity":"SupportTicket","tenant_field":"business_id"}'::jsonb),

  ('liuma', 'LIUMA', 'base44', '696e967c430ceb6a2232ffd8',
   'https://liuma.acacia.co',
   '{"license_entity":"SchoolSubscription","ticket_entity":"SupportTicket","ticket_message_entity":"SupportTicketMessage","tenant_field":"school_id"}'::jsonb),

  ('flowfin', 'FlowFin', 'base44', '69b97ea9c9a713486b5a01fd',
   'https://flowfin.acacia.co',
   '{"license_entity":"Family","tenant_field":"id"}'::jsonb),

  ('stockflow', 'StockFlow', 'base44', '69af971d0fdb362c9ae52ed3',
   'https://stockflow.acacia.co',
   '{"license_entity":"Business","ticket_entity":"SupportTicket","tenant_field":"business_id"}'::jsonb),

  ('plink_fx', 'Plink FX', 'external', null,
   'https://plink.fx',
   '{}'::jsonb)
on conflict (id) do update set
  name        = excluded.name,
  backend     = excluded.backend,
  external_id = excluded.external_id,
  url         = excluded.url,
  config      = excluded.config,
  updated_at  = now();
