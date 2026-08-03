// api/_lib/portfolioLifecycle.js
// Lógica pura del ciclo de vida de licencia UNIFICADO (portafolio completo,
// distinto del ciclo por-etapa de CateqHub en licenseLifecycle.js). Sin
// imports ni efectos, para que sea trivialmente testeable
// (portfolioLifecycle.test.js). El orquestador vive en api/cron/license-lifecycle.js.
//
// Reglas de negocio (ver docs/superpowers/specs/2026-08-03-portfolio-license-lifecycle-design.md):
//   - Acumulado desde current_period_end (NO por-etapa, a diferencia de CateqHub):
//     día 8 → read_only, día 15 → blocked, día 30 → inactive, día 45 → deletion_eligible.
//   - read_only y blocked solo escriben al app si cfg.readOnlyStatus/blockedStatus
//     existen (rumbo/radar no tienen read-only en su schema hoy — targetStatus
//     queda null, pero la etapa se sigue reportando para mandar el correo).
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
  if (days < cfg.graceDaysToInactive) {
    return { stage: 'blocked', targetStatus: cfg.blockedStatus ?? null }
  }
  if (days < cfg.graceDaysToDeletionEligible) {
    return { stage: 'inactive', targetStatus: cfg.blockedStatus ?? null }
  }
  return { stage: 'deletion_eligible', targetStatus: cfg.blockedStatus ?? null }
}

export function emailKindForStage(stage) {
  if (stage === 'read_only') return 'license_read_only'
  if (stage === 'blocked') return 'license_blocked'
  if (stage === 'inactive') return 'license_inactive_warning'
  return null
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
