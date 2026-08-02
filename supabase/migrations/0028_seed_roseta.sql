-- ============================================================================
-- Roseta Café (acaciaco-site/roseta/) es un micrositio de cliente real, en
-- producción desde hace varios commits (landing + flujo de solicitud de
-- factura, api/roseta/), pero nunca se dio de alta en el registro de
-- Mission Control — a diferencia de Baristop (site-baristop) y Mundial 2026
-- (site-mundial-2026), que sí están seedeados desde 0005_portfolio_categories.
-- Sin esta fila, la sección "Sitios web" del Dashboard/Productos nunca podía
-- mostrarlo, aunque el sitio en sí sí está live.
-- ============================================================================
insert into public.apps (id, name, backend, category, url, status, config) values
  ('site-roseta','Roseta Café','static','site','https://acaciaco.com.mx/roseta','active','{}')
on conflict (id) do update set
  name = excluded.name, backend = excluded.backend, category = excluded.category,
  url = excluded.url, status = excluded.status, updated_at = now();
