-- ============================================================================
-- Baja de licencias — metadata que POSEE Mission Control (no la app).
--
-- "Dar de baja" hace dos cosas y las dos importan:
--   1) escribe la app (status cancelado/bloqueado + vencimiento = ahora) vía el
--      puente acaciaControl — eso es lo que de verdad corta el acceso;
--   2) archiva el renglón de la bodega, que es lo que lo saca del panel.
--
-- El (2) necesita columnas propias porque el registro sigue existiendo en la
-- app: el sync diario lo vuelve a leer y lo vuelve a hacer upsert. El upsert de
-- syncLicenses NO incluye estas columnas (igual que `auto_renew`, ver 0017), así
-- que el archivado sobrevive a cada re-sync en vez de deshacerse solo.
--
-- Nada se borra aquí: `archived_at` es reversible desde el panel ("Restaurar").
-- El borrado duro del renglón (owner) es un DELETE normal, sin columna.
-- ============================================================================

alter table public.licenses
  add column if not exists archived_at    timestamptz,
  add column if not exists archived_by    text,
  add column if not exists archive_reason text;

-- El panel filtra por "activas" (archived_at is null) en cada carga.
create index if not exists licenses_archived_at on public.licenses (archived_at);

comment on column public.licenses.archived_at is
  'Dada de baja desde Mission Control. Sobrevive al re-sync: syncLicenses no escribe esta columna.';
