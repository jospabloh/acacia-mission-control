-- ============================================================================
-- Método de Cubetas (acaciaco-site/freeware/metodo-cubetas/) es otra herramienta
-- de freeware real, en producción, que nunca se dio de alta en el registro de
-- Mission Control — mismo patrón que Roseta (0028_seed_roseta): confirmado por
-- el sitemap.xml del sitio (que sí la lista) y por el commit
-- "Add Método de Cubetas freeware app + document freeware module split decision".
-- ============================================================================
insert into public.apps (id, name, backend, category, url, status, config) values
  ('fw-metodo-cubetas','Método de Cubetas','static','freeware','https://acaciaco.com.mx/freeware/metodo-cubetas','active','{}')
on conflict (id) do update set
  name = excluded.name, backend = excluded.backend, category = excluded.category,
  url = excluded.url, status = excluded.status, updated_at = now();
