-- ============================================================================
-- ACACIA Mission Control — 0044_cateqhub_no_free_plan
--
-- CateqHub eliminó su plan gratuito el 2026-09-09 (app 1.10.0). Esta migración
-- corrige el `field_defaults` que 0043 puso hace un día, porque ahora nombra un
-- plan que ya no existe.
--
-- 0043 resolvió un problema real y sigue vigente: la única parroquia en
-- producción se creó el 2026-07-22, ANTES de que `plan` y `license_status`
-- existieran en el esquema de Parish. Los `default` de un `.jsonc` se aplican
-- al crear el registro, no retroactivamente, así que el puente manda un
-- registro sin esas claves y el panel pintaba "—"/"—" — indistinguible de un
-- sync roto. 0043 le enseñó al lado que LEE a resolver la ausencia.
--
-- Lo que cambia es a QUÉ resuelve. Antes 'free', que era un plan real de la
-- app. Ya no lo es, y un default que nombra un plan inexistente es peor que el
-- null que reemplazó: le enseña al operador un producto que nadie puede
-- contratar.
--
-- 'sin_licencia' es deliberadamente un valor que NO está en
-- `licenseControl.js` → cateqhub.plans (hoy ['premium']). Eso importa por dos
-- razones:
--
--   1. No aparece en el desplegable de `set_plan`, así que ningún operador
--      puede ponerle ese valor a una parroquia. Es cómo el panel RENDERIZA una
--      ausencia, no un plan en el que alguien esté.
--   2. Queda fuera de `lifecycle.paidPlanValues` (['premium']), que es la
--      condición que `portfolioLifecycle.js` usa para barrer filas hacia el
--      cron de licencias y sus correos a clientes. Meter el default DENTRO de
--      esa lista le mandaría correos de vencimiento a la parroquia demo.
--      `licenseMapping.js` lo advierte en su cabecera; esto lo respeta.
--
-- El `status: 'active'` no cambia: la app sigue resolviendo un
-- `license_status` ausente como activo (`getLicenseStatus` en src/lib/
-- premium.js), así que el panel y la app siguen diciendo lo mismo.
-- ============================================================================

update public.apps
set config = jsonb_set(
  config,
  '{field_defaults}',
  '{"plan": "sin_licencia", "status": "active"}'::jsonb,
  true
)
where id = 'cateqhub';
