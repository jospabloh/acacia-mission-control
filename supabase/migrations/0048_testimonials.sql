-- ============================================================================
-- Testimonios (contrato docs: specs/testimonios-contract.md, 2026-10-07).
-- Cada app guarda el testimonio de su tenant; Mission Control lo trae por el
-- puente (api/_lib/ingest/testimonial-pull.js + respaldo del sync diario), lo
-- revisa un admin y SOLO los `approved` con consentimiento salen por
-- GET /api/testimonials. El estado de revisión es de MC (`status`), no el de la app.
-- Idempotente.
-- ============================================================================
create table if not exists public.testimonials (
  id                 uuid primary key default gen_random_uuid(),
  app_id             text not null references public.apps(id) on delete cascade,
  external_id        text not null,
  tenant_external_id text,
  tenant_name        text,
  rating             smallint not null check (rating between 1 and 5),
  -- Retirar BORRA el texto (Módulo 28): body/author_name quedan '' y
  -- consent_publish false, pero solo en una fila `withdrawn`. Cualquier otra
  -- fila cumple los límites del contrato §1.
  body               text not null,
  author_name        text not null,
  author_role        text check (author_role is null or char_length(author_role) <= 80),
  consent_publish    boolean not null default false,
  consent_at         timestamptz,
  submitted_at       timestamptz,
  status             text not null default 'pending'
                     check (status in ('pending','approved','rejected','withdrawn')),
  reviewed_by        text,
  reviewed_at        timestamptz,
  notified_at        timestamptz,   -- último aviso al equipo; máx. uno por hora
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (app_id, external_id),
  check (status = 'withdrawn' or char_length(body) between 20 and 600),
  check (status = 'withdrawn' or char_length(author_name) between 1 and 80),
  check (status = 'withdrawn' or consent_publish)
);

create index if not exists testimonials_status on public.testimonials (status, submitted_at desc);

drop trigger if exists trg_testimonials_touch on public.testimonials;
create trigger trg_testimonials_touch before update on public.testimonials
  for each row execute function public.touch_updated_at();

alter table public.testimonials enable row level security;

-- Mismo patrón que el resto de las tablas operativas (0001): viewer lee,
-- admin escribe. El service_role (api/) se salta RLS.
drop policy if exists testimonials_read on public.testimonials;
create policy testimonials_read on public.testimonials
  for select using (public.is_member_at_least('viewer'));
drop policy if exists testimonials_write on public.testimonials;
create policy testimonials_write on public.testimonials
  for all using (public.is_member_at_least('admin'))
  with check (public.is_member_at_least('admin'));
