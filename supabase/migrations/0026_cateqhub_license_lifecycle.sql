-- ============================================================================
-- Ciclo de vida de licencia Premium para CateqHub (solo-lectura → acceso
-- denegado → elegible para borrado). Ver docs/superpowers/specs/2026-07-23-
-- cateqhub-premium-license-lifecycle-design.md.
--
--   1) license_lifecycle_reminders — bitácora de idempotencia de los
--      recordatorios semanales del cron license-lifecycle. unique(app_id,
--      external_id, period, kind) permite como máximo un correo de cada tipo
--      por tenant por semana, y el cron se puede reejecutar el mismo día sin
--      duplicar envíos.
--   2) apps.config.field_map de cateqhub — reemplaza el field_map parcial de
--      la migración 0025 (que todavía mapeaba trial_ends_at, campo que ya NO
--      existe en Parish desde que CateqHub eliminó el concepto de prueba
--      temporal) por el mapeo completo: status → license_status,
--      current_period_end → premium_period_end_at.
-- ============================================================================

create table if not exists public.license_lifecycle_reminders (
  id          uuid primary key default gen_random_uuid(),
  app_id      text not null references public.apps(id) on delete cascade,
  external_id text not null,                     -- id de la Parish en el app
  period      text not null,                     -- 'YYYY-MM-DD', lunes UTC de la semana del envío
  kind        text not null,                     -- 'premium_read_only_reminder' | 'premium_access_denied_reminder'
  recipient   text,
  sent_at     timestamptz not null default now(),
  unique (app_id, external_id, period, kind)
);

create index if not exists license_lifecycle_reminders_app_period
  on public.license_lifecycle_reminders (app_id, period);

-- RLS: mismo patrón que renewal_reminders (0017) — miembros (viewer+) leen,
-- solo el service_role (el cron) escribe.
alter table public.license_lifecycle_reminders enable row level security;

create policy license_lifecycle_reminders_read on public.license_lifecycle_reminders
  for select using (public.is_member_at_least('viewer'));

update public.apps
  set config = config || '{
    "field_map": {
      "tenant_external_id": "id",
      "name": "name",
      "plan": "plan",
      "status": "license_status",
      "current_period_end": "premium_period_end_at"
    }
  }'::jsonb
  where id = 'cateqhub';
