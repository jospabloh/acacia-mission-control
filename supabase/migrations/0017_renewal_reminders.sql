-- ============================================================================
-- Correos de renovación de licencia por tenant.
--   1) licenses.auto_renew — metadata que POSEE Mission Control (no la app).
--      Marca qué tenants están en cobro automático de Mercado Pago, para elegir
--      el correo del día 1: aviso de cargo (renewal_fyi) vs recordatorio (renewal).
--      El upsert del sync (syncLicenses) no incluye esta columna, así que los
--      valores puestos por el operador se conservan; los renglones nuevos toman
--      el default `false`.
--   2) renewal_reminders — bitácora de idempotencia del cron mensual. El
--      unique(app_id, external_id, period) garantiza un correo por tenant por
--      mes, así el cron se puede reejecutar el mismo día 1 sin duplicar.
-- ============================================================================

alter table public.licenses
  add column if not exists auto_renew boolean not null default false;

create table if not exists public.renewal_reminders (
  id          uuid primary key default gen_random_uuid(),
  app_id      text not null references public.apps(id) on delete cascade,
  external_id text not null,                     -- id de la licencia en el app
  period      text not null,                     -- 'YYYY-MM' del envío
  kind        text not null,                     -- 'renewal' | 'renewal_fyi'
  recipient   text,                              -- correo al que se envió
  sent_at     timestamptz not null default now(),
  unique (app_id, external_id, period)
);

create index if not exists renewal_reminders_app_period
  on public.renewal_reminders (app_id, period);

-- RLS: los miembros (viewer+) pueden leer la bitácora; escribir es exclusivo del
-- service_role (el cron), igual que el resto de tablas que llenan cron/webhooks.
alter table public.renewal_reminders enable row level security;

create policy renewal_reminders_read on public.renewal_reminders
  for select using (public.is_member_at_least('viewer'));
