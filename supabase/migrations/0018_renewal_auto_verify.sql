-- ============================================================================
-- Renovación automática con verificación manual pendiente.
-- El cron del día 1, para tenants en cobro automático (auto_renew = true) que NO
-- estén suspendidos/cancelados, extiende la licencia al 1° del mes siguiente y
-- deja el registro marcado como "renovado, pendiente de verificar" para que el
-- operador confirme (en Licencias) que el cargo de Mercado Pago sí se realizó.
-- ============================================================================

alter table public.renewal_reminders
  add column if not exists renewed     boolean not null default false, -- ¿se extendió la licencia?
  add column if not exists new_expiry  timestamptz,                    -- vencimiento que quedó
  add column if not exists verified    boolean not null default false, -- operador confirmó el cargo
  add column if not exists verified_at timestamptz,
  add column if not exists verified_by text;

-- El operador (admin) marca "verificado" desde la UI: es un write de bodega, sin
-- puente. Permitir UPDATE a admin+ (mismo criterio que escribir licenses).
-- El INSERT sigue siendo exclusivo del service_role (el cron).
create policy renewal_reminders_verify on public.renewal_reminders
  for update using (public.is_member_at_least('admin'))
  with check (public.is_member_at_least('admin'));
