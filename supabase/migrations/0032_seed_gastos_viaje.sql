-- ============================================================================
-- Gastos de Viaje (acaciaco-site/freeware/gastos-viaje/) — alta en el registro.
-- Herramienta freeware estática: el reporte de viáticos se captura, se calcula
-- y se exporta 100% en el navegador, sin backend propio, así que no hay
-- adaptador que configurar (backend 'static', config vacío).
--
-- Con esta fila, api/web-kpis.js le atribuye el tráfico por prefijo de URL
-- (/freeware/gastos-viaje) y la herramienta aparece en Portafolio con visitas y
-- visitantes únicos de 30 días. La misma atribución recoge el evento de
-- exportación que la app manda a /api/track como
-- /freeware/gastos-viaje/exportado — es decir, el panel no ve sólo tráfico:
-- ve cuánta gente termina su reporte. Sin esquema nuevo ni RLS nueva.
--
-- Idempotente: re-ejecutarla actualiza la fila en su lugar.
-- ============================================================================
insert into public.apps (id, name, backend, category, url, status, config) values
  ('fw-gastos-viaje','Gastos de Viaje','static','freeware','https://acaciaco.com.mx/freeware/gastos-viaje','active','{}')
on conflict (id) do update set
  name = excluded.name, backend = excluded.backend, category = excluded.category,
  url = excluded.url, status = excluded.status, updated_at = now();
