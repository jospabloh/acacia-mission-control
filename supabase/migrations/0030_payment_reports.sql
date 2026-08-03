-- ============================================================================
-- Reporte de pago pendiente de confirmación del owner (ver spec
-- docs/superpowers/specs/2026-08-03-portfolio-license-lifecycle-design.md,
-- decisión #4). Un admin registra que un tenant avisó que pagó (por WhatsApp/
-- correo/ticket — los tenants no tienen acceso a Mission Control); solo
-- owner puede confirmarlo, lo cual dispara confirm_payment de verdad
-- (api/_lib/control/payment-confirm.js). Sin reporte previo, confirm_payment
-- sigue disponible directo para admin — este reporte es trazabilidad
-- adicional, no un gate nuevo sobre la acción que ya existe.
-- ============================================================================
create table public.payment_reports (
  id            uuid primary key default gen_random_uuid(),
  app_id        text not null references public.apps(id) on delete cascade,
  external_id   text not null,
  amount        numeric,
  reference     text,
  note          text,
  reported_by   text not null,
  reported_at   timestamptz not null default now(),
  confirmed_by  text,
  confirmed_at  timestamptz
);

create index payment_reports_pending
  on public.payment_reports (app_id, external_id)
  where confirmed_at is null;

alter table public.payment_reports enable row level security;

-- Mismo patrón que usage_reminders (0027)/renewal_reminders (0017): viewer+
-- lee, solo el service_role (los endpoints de control, con su propio gate de
-- rol vía requireMember) escribe.
create policy payment_reports_read on public.payment_reports
  for select using (public.is_member_at_least('viewer'));
