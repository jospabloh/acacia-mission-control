-- ============================================================================
-- ACACIA Mission Control — 0015_seed_radar_app
-- Register RADAR (HR / attendance, Base44 app) in the app registry so Mission
-- Control can sync its licenses/usage and operate its support tickets, using
-- the same patterns as the rest of the portfolio.
--
-- RADAR's ticket + license model (source: jospabloh/radar base44/entities/*.jsonc):
--   - License/business entity: Company (tier starter|pro|enterprise,
--     status active|suspended, license_expiry date, max_employees).
--   - Tickets: SupportTicket + SupportTicketMessage, tenant FK = company_id.
--   - Real-time ingest: PUSH (radar hosts notifyTicketCreated; <50 functions).
--
-- Config mirrors the shape assembled for the other apps across 0002/0004/0006/
-- 0013: registry row + license field_map + usage_entities + ticket entities.
-- Idempotent: re-running updates the row in place.
-- ============================================================================

insert into public.apps (id, name, backend, external_id, url, config) values
  ('radar', 'Radar', 'base44', '6a455cf7813a409378d2af35',
   'https://radar.acaciaco.com.mx',
   '{
      "license_entity": "Company",
      "ticket_entity": "SupportTicket",
      "ticket_message_entity": "SupportTicketMessage",
      "tenant_field": "company_id",
      "field_map": {
        "tenant_external_id": "id",
        "name": "name",
        "plan": "tier",
        "status": "status",
        "seats": "max_employees",
        "current_period_end": "license_expiry"
      },
      "usage_entities": ["Employee", "AttendanceRecord", "PTORequest"]
    }'::jsonb)
on conflict (id) do update set
  name        = excluded.name,
  backend     = excluded.backend,
  external_id = excluded.external_id,
  url         = excluded.url,
  config      = excluded.config,
  updated_at  = now();
