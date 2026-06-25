-- ============================================================================
-- Categorize the portfolio and seed the full catalog so the Dashboard can group
-- Apps (SaaS) · Freeware (free webapps) · Sitios (websites). Every row carries a
-- live URL so its card is actionable (click → open the real thing).
-- ============================================================================
alter table public.apps add column if not exists category text not null default 'app';
alter table public.apps drop constraint if exists apps_category_check;
alter table public.apps add constraint apps_category_check
  check (category in ('app', 'freeware', 'site'));

-- Existing rows
update public.apps set category = 'app'
  where id in ('puntos', 'rumbo', 'liuma', 'flowfin', 'stockflow');
update public.apps set category = 'freeware', name = 'Plink FX',
  url = 'https://acaciaco.com.mx/freeware/plink-fx'
  where id = 'plink_fx';

-- Freeware (free tools on acaciaco.com.mx/freeware/*)
insert into public.apps (id, name, backend, category, url, status, config) values
  ('fw-calculadora-finiquito','Calculadora de Finiquito','static','freeware','https://acaciaco.com.mx/freeware/calculadora-finiquito','active','{}'),
  ('fw-calculadora-iva','Calculadora de IVA','static','freeware','https://acaciaco.com.mx/freeware/calculadora-iva','active','{}'),
  ('fw-comparar-textos','Comparar Textos','static','freeware','https://acaciaco.com.mx/freeware/comparar-textos','active','{}'),
  ('fw-comprimir-imagenes','Comprimir Imágenes','static','freeware','https://acaciaco.com.mx/freeware/comprimir-imagenes','active','{}'),
  ('fw-comprimir-pdf','Comprimir PDF','static','freeware','https://acaciaco.com.mx/freeware/comprimir-pdf','active','{}'),
  ('fw-contador-palabras','Contador de Palabras','static','freeware','https://acaciaco.com.mx/freeware/contador-palabras','active','{}'),
  ('fw-csv-a-json','CSV a JSON','static','freeware','https://acaciaco.com.mx/freeware/csv-a-json','active','{}'),
  ('fw-dividir-pdf','Dividir PDF','static','freeware','https://acaciaco.com.mx/freeware/dividir-pdf','active','{}'),
  ('fw-extraer-texto-imagen','Extraer Texto de Imagen','static','freeware','https://acaciaco.com.mx/freeware/extraer-texto-imagen','active','{}'),
  ('fw-generador-contrasenas','Generador de Contraseñas','static','freeware','https://acaciaco.com.mx/freeware/generador-contrasenas','active','{}'),
  ('fw-generador-facturas','Generador de Facturas','static','freeware','https://acaciaco.com.mx/freeware/generador-facturas','active','{}'),
  ('fw-generador-qr','Generador de QR','static','freeware','https://acaciaco.com.mx/freeware/generador-qr','active','{}'),
  ('fw-jpg-a-pdf','JPG a PDF','static','freeware','https://acaciaco.com.mx/freeware/jpg-a-pdf','active','{}'),
  ('fw-optimizador-prompts','Optimizador de Prompts','static','freeware','https://acaciaco.com.mx/freeware/optimizador-prompts','active','{}'),
  ('fw-pdf-a-jpg','PDF a JPG','static','freeware','https://acaciaco.com.mx/freeware/pdf-a-jpg','active','{}'),
  ('fw-presupuesto-50-30-20','Presupuesto 50/30/20','static','freeware','https://acaciaco.com.mx/freeware/presupuesto-50-30-20','active','{}'),
  ('fw-sueldo-neto','Sueldo Neto','static','freeware','https://acaciaco.com.mx/freeware/sueldo-neto','active','{}'),
  ('fw-unir-pdf','Unir PDF','static','freeware','https://acaciaco.com.mx/freeware/unir-pdf','active','{}'),
  -- Sitios web
  ('site-acaciaco','ACACIA Consultoría','static','site','https://acaciaco.com.mx','active','{}'),
  ('site-baristop','Baristop','static','site','https://acaciaco.com.mx/baristop','active','{}')
on conflict (id) do update set
  name = excluded.name, backend = excluded.backend, category = excluded.category,
  url = excluded.url, status = excluded.status, updated_at = now();
