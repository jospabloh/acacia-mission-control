-- 0019_stockflow_cursos_entities.sql
-- StockFlow lanzó el módulo de Cursos (cursos, calendario, inscripciones,
-- contactos, campañas). Agregamos sus entidades a usage_entities para que el
-- snapshot diario (usage.summary vía acaciaControl) cuente el uso real del
-- feature y aparezca automáticamente en Analytics y en el detalle del app.
--
-- Antes: ["Product","Movement","Client"]
-- Después: + Course, Enrollment, Contact, Campaign
update public.apps
set config = jsonb_set(
  config,
  '{usage_entities}',
  '["Product","Movement","Client","Course","Enrollment","Contact","Campaign"]'::jsonb
)
where id = 'stockflow';
