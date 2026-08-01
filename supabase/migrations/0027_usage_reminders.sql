-- ============================================================================
-- Recordatorio de uso (motivacional) — para tenants con licencia activa que
-- dejaron de entrar a la app. Ver api/_lib/usageReminders.js.
--
--   1) tenants.last_seen_active_at — sellado por el cron usage-reminders cada
--      vez que ve a un contacto del tenant en app_sessions (sesión abierta,
--      últimas 24h). app_sessions en sí NO sirve como reloj de inactividad:
--      su sync purga toda fila que se sale de esas 24h (ver OPEN_WINDOW_MS en
--      _lib/sessions.js), así que sin esta columna no hay forma de distinguir
--      "no ha entrado en 3 semanas" de "nunca ha entrado" una vez pasa un día.
--   2) usage_reminders — bitácora de idempotencia del cron. unique(app_id,
--      external_id, period) igual que renewal_reminders (0017): como máximo
--      un correo por tenant por mes, para no ser insistentes con quien de
--      plano dejó de usarla.
-- ============================================================================

alter table public.tenants
  add column if not exists last_seen_active_at timestamptz;

create table if not exists public.usage_reminders (
  id          uuid primary key default gen_random_uuid(),
  app_id      text not null references public.apps(id) on delete cascade,
  external_id text not null,                     -- id del tenant en el app
  period      text not null,                     -- 'YYYY-MM' del envío
  kind        text not null default 'usage_reminder',
  recipient   text,
  sent_at     timestamptz not null default now(),
  unique (app_id, external_id, period)
);

create index if not exists usage_reminders_app_period
  on public.usage_reminders (app_id, period);

-- RLS: mismo patrón que renewal_reminders (0017) — miembros (viewer+) leen,
-- solo el service_role (el cron) escribe.
alter table public.usage_reminders enable row level security;

create policy usage_reminders_read on public.usage_reminders
  for select using (public.is_member_at_least('viewer'));
