// Lógica pura del ciclo de vida de licencia Premium (solo-lectura → acceso
// denegado → elegible para borrado). Sin imports ni efectos, para que sea
// trivialmente testeable (licenseLifecycle.test.js). El orquestador que toca
// bodega + puente vive en api/cron/license-lifecycle.js.
//
// Reglas de negocio (ver docs/superpowers/specs/2026-07-23-cateqhub-premium-license-lifecycle-design.md):
//   - Solo aplica a licencias con plan en lifecycleCfg.paidPlanValues.
//   - active → read_only: tras graceDaysToReadOnly días vencido el período pagado.
//   - read_only → access_denied: tras graceDaysToAccessDenied días en read_only.
//   - access_denied → deletion_eligible: tras graceDaysToDeletionEligible días en
//     access_denied Y sin exportación confirmada. Una sola vez (nunca se
//     re-dispara si deletion_eligible_since ya está seteado).
//   - deletion_eligible es terminal: solo una acción humana (borrado manual,
//     ver license-delete-premium-data) sale de ahí.

const DAY = 86_400_000

function daysSince(iso, now) {
  if (!iso) return null
  const t = new Date(iso).getTime()
  if (Number.isNaN(t)) return null
  return (now.getTime() - t) / DAY
}

// Calcula la siguiente transición de estado para una licencia, o null si no
// corresponde ninguna todavía. `now` inyectable para tests deterministas.
export function computeLifecycleTransition(license, lifecycleCfg, now = new Date()) {
  if (!lifecycleCfg.paidPlanValues.includes(license.plan)) return null

  const status = license.status || 'active'
  const sf = lifecycleCfg.sinceFields

  if (status === 'active') {
    const days = daysSince(license.premium_period_end_at, now)
    if (days === null || days < lifecycleCfg.graceDaysToReadOnly) return null
    return { toStatus: 'read_only', sinceField: sf.read_only }
  }

  if (status === 'read_only') {
    const days = daysSince(license.read_only_since, now)
    if (days === null || days < lifecycleCfg.graceDaysToAccessDenied) return null
    return { toStatus: 'access_denied', sinceField: sf.access_denied }
  }

  if (status === 'access_denied') {
    if (license[lifecycleCfg.exportConfirmedField]) return null // ya exportó, no avanza sola
    if (license.deletion_eligible_since) return null // ya se marcó, no se re-dispara
    const days = daysSince(license.access_denied_since, now)
    if (days === null || days < lifecycleCfg.graceDaysToDeletionEligible) return null
    return { toStatus: 'deletion_eligible', sinceField: sf.deletion_eligible }
  }

  return null // deletion_eligible es terminal — solo sale por acción humana
}

// Decide si, en vez de aplicar la transición active → read_only, hay que
// bajar la parroquia directo a un plan gratuito permanente (cfg.freeDowngrade
// — hoy solo cateqhub). Solo aplica a la PRIMERA transición del ciclo: una
// vez que una licencia ya está en read_only/access_denied/deletion_eligible
// (porque tiene más consumo del que el plan gratuito permite), no se
// reconsidera en cada corrida — si el tenant reduce su consumo mientras está
// ahí, la baja a gratis la hace un humano (o confirm_payment), no el cron;
// si no, oscilaría entre estados en corridas sucesivas según el conteo del
// día. `usageCount` ya viene resuelto por el llamador (IO real vive en el
// cron, esto se queda puro/testeable) — null cuando la consulta falló o no
// se pudo resolver, y en ese caso NUNCA se arriesga el downgrade (se sigue
// el ciclo normal, más conservador que dejar pasar un tenant que sí debía
// restringirse).
export function shouldDowngradeToFree(freeDowngradeCfg, transition, usageCount) {
  if (!freeDowngradeCfg || !transition || transition.toStatus !== 'read_only') return false
  if (usageCount == null) return false
  return usageCount <= freeDowngradeCfg.childCap
}

// Qué tipo de recordatorio semanal corresponde a un estado (o ninguno).
export function reminderKindFor(status) {
  if (status === 'read_only') return 'premium_read_only_reminder'
  if (status === 'access_denied') return 'premium_access_denied_reminder'
  return null
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
