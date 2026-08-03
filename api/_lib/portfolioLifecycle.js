// api/_lib/portfolioLifecycle.js
// Lógica pura del ciclo de vida de licencia UNIFICADO — usado por los 7 apps
// del portafolio con licencia de asiento (incluye CateqHub desde 2026-08-03,
// ver abajo). Sin imports ni efectos, para que sea trivialmente testeable
// (portfolioLifecycle.test.js). El orquestador vive en api/cron/license-lifecycle.js.
//
// Reglas de negocio (ver docs/superpowers/specs/2026-08-03-portfolio-license-lifecycle-design.md):
//   - Acumulado desde current_period_end/premium_period_end_at (NO por-etapa —
//     CateqHub usaba un modelo por-etapa propio de 15/15/30 días con
//     since-fields independientes hasta que el owner de la plataforma pidió
//     explícitamente "no exceptions" (2026-08-03): mismo ciclo 8/15/30/45
//     acumulado que los otros 6, sin campo `sinceFields`. Ver
//     licenseControl.js#cateqhub y license-lifecycle.js — ya no existe una
//     rama "staged" separada en el cron.
//     día 8 → read_only, día 15 → blocked, día 30 → inactive, día 45 → deletion_eligible.
//   - read_only y blocked solo escriben al app si cfg.readOnlyStatus/blockedStatus
//     existen (rumbo/radar no tenían read-only en su schema hasta 2026-08-03,
//     ver licenseControl.js — ahora los 7 apps lo tienen).
//   - inactive y deletion_eligible son bookkeeping interno de Mission Control
//     (etapas distintas para elegir correo/futuras revisiones), pero su
//     targetStatus es el MISMO cfg.blockedStatus que `blocked` — así un
//     tenant observado por primera vez YA muy vencido (día 30/45 desde el
//     arranque del cron, un bridge caído semanas, u onboarding a mitad de
//     ciclo) igual queda bloqueado, en vez de quedarse en su status previo
//     para siempre porque nunca pasó por el escalón `blocked`. El guard
//     `lic.status !== targetStatus` en el cron ya hace esto un no-op para
//     quien ya estaba bloqueado desde el día 15.
//   - deletion_eligible nunca manda correo al tenant — solo alerta interna
//     (ver Licenses.jsx, fuera de este plan). El borrado real nunca es automático.
//   - plan === 'founder' NUNCA entra al ciclo (plan oculto, vitalicio por
//     diseño — ver spec §Decisiones #5) — se excluye aquí explícitamente, no
//     confiando en que current_period_end quede en null en algún otro punto
//     del sistema (si algún día un tenant Founder SÍ trae una fecha vieja de
//     un plan anterior, este chequeo evita que el ciclo lo alcance igual).
//   - cfg.exportConfirmedField (hoy solo CateqHub, `export_confirmed_at`):
//     si el tenant ya confirmó su exportación de datos antes de que la
//     restricción llegue a `blocked`, el ciclo NUNCA avanza más allá de
//     `blocked` — se queda ahí para siempre hasta acción humana, igual que
//     el modelo por-etapa que reemplaza (ahí la exportación bloqueaba
//     únicamente el paso access_denied → deletion_eligible; acá, en días
//     acumulados, ese es el mismo punto: no pasar de `blocked`).

const DAY = 86_400_000

function daysSince(iso, now) {
  if (!iso) return null
  const t = new Date(iso).getTime()
  if (Number.isNaN(t)) return null
  return (now.getTime() - t) / DAY
}

export function computePortfolioLifecycleStage(license, cfg, now = new Date()) {
  if (license.plan === 'founder') return null
  const days = daysSince(license.current_period_end, now)
  if (days === null || days < cfg.graceDaysToReadOnly) return null

  if (days < cfg.graceDaysToBlocked) {
    return { stage: 'read_only', targetStatus: cfg.readOnlyStatus ?? null }
  }
  const exportConfirmed = !!(cfg.exportConfirmedField && license[cfg.exportConfirmedField])
  if (days < cfg.graceDaysToInactive || exportConfirmed) {
    return { stage: 'blocked', targetStatus: cfg.blockedStatus ?? null }
  }
  if (days < cfg.graceDaysToDeletionEligible) {
    return { stage: 'inactive', targetStatus: cfg.blockedStatus ?? null }
  }
  return { stage: 'deletion_eligible', targetStatus: cfg.blockedStatus ?? null }
}

// Kind de correo por etapa, con override opcional por app (cfg.lifecycle.emailKinds
// — hoy solo CateqHub, que conserva su copy propio mencionando la exportación
// de Tutores en vez del texto genérico). `overrides` puede venir undefined.
export function emailKindForStage(stage, overrides) {
  if (overrides && stage in overrides) return overrides[stage]
  if (stage === 'read_only') return 'license_read_only'
  if (stage === 'blocked') return 'license_blocked'
  if (stage === 'inactive') return 'license_inactive_warning'
  return null
}

// Decide si, en vez de aplicar la transición a `read_only`, hay que bajar el
// tenant directo a un plan gratuito permanente (cfg.freeDowngrade — hoy solo
// CateqHub). Solo aplica a la PRIMERA etapa del ciclo: una vez que un tenant
// ya está en read_only/blocked/inactive/deletion_eligible (porque tiene más
// consumo del que el plan gratuito permite), no se reconsidera en cada
// corrida — si el tenant reduce su consumo mientras está ahí, la baja a
// gratis la hace un humano (o set_plan), no el cron; si no, oscilaría entre
// estados en corridas sucesivas según el conteo del día. `usageCount` ya
// viene resuelto por el llamador (IO real vive en el cron, esto se queda
// puro/testeable) — null cuando la consulta falló o no se pudo resolver, y
// en ese caso NUNCA se arriesga el downgrade (se sigue el ciclo normal, más
// conservador que dejar pasar un tenant que sí debía restringirse).
export function shouldDowngradeToFree(freeDowngradeCfg, stage, usageCount) {
  if (!freeDowngradeCfg || stage !== 'read_only') return false
  if (usageCount == null) return false
  return usageCount <= freeDowngradeCfg.childCap
}

// Clave de bucket semanal (lunes UTC de la semana de `now`), para deduplicar
// recordatorios — como máximo uno por tenant por semana.
export function weekBucketKey(now = new Date()) {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
  const dow = d.getUTCDay() // 0=domingo..6=sábado
  const diffToMonday = dow === 0 ? -6 : 1 - dow
  d.setUTCDate(d.getUTCDate() + diffToMonday)
  return d.toISOString().slice(0, 10)
}

// Filtra a solo licencias con plan en cfg.lifecycle.paidPlanValues — igual
// criterio que la rama staged (runStagedLifecycleForApp, `premium`), pero
// para el ciclo unificado. Sin esto, un tenant en un plan no-pago (p.ej.
// 'trial') con current_period_end vencido se cuela al enforcement —
// confirmado en producción con un tenant Rumbo en plan 'trial' 6 días
// vencido. Pura y exportada para poder testearla sin supabaseAdmin (ver
// portfolioLifecycle.test.js). Vive aquí (no en api/cron/license-lifecycle.js)
// porque es lógica pura sin I/O sobre qué licencias califican para el ciclo
// unificado — mismo criterio que computePortfolioLifecycleStage/emailKindForStage
// de arriba.
export function filterPaidLicenses(lics, cfg) {
  return (lics ?? []).filter((l) => cfg.lifecycle.paidPlanValues.includes(l.plan))
}
