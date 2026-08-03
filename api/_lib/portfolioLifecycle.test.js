// api/_lib/portfolioLifecycle.test.js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { computePortfolioLifecycleStage, emailKindForStage, filterPaidLicenses } from './portfolioLifecycle.js'
import { licenseControlFor } from './licenseControl.js'

const CFG = {
  graceDaysToReadOnly: 8, graceDaysToBlocked: 15, graceDaysToInactive: 30, graceDaysToDeletionEligible: 45,
  readOnlyStatus: 'view_only', blockedStatus: 'suspended',
}
const NOW = new Date('2026-08-03T00:00:00Z')

test('sin current_period_end no hay etapa', () => {
  assert.equal(computePortfolioLifecycleStage({ plan: 'pro', status: 'active', current_period_end: null }, CFG, NOW), null)
})

test("plan 'founder' nunca entra al ciclo, incluso con current_period_end vencido", () => {
  const lic = { plan: 'founder', status: 'active', current_period_end: '2026-06-01T00:00:00Z' } // muy vencido
  assert.equal(computePortfolioLifecycleStage(lic, CFG, NOW), null)
})

test('dentro de los 8 días de gracia no hay etapa', () => {
  // Venció hace 7 días.
  const lic = { plan: 'pro', status: 'active', current_period_end: '2026-07-27T00:00:00Z' }
  assert.equal(computePortfolioLifecycleStage(lic, CFG, NOW), null)
})

test('día 8 (acumulado): read_only, con el status del app si lo soporta', () => {
  // Venció hace exactamente 8 días.
  const lic = { plan: 'pro', status: 'active', current_period_end: '2026-07-26T00:00:00Z' }
  assert.deepEqual(computePortfolioLifecycleStage(lic, CFG, NOW), { stage: 'read_only', targetStatus: 'view_only' })
})

test('día 8, app sin read-only en su schema (enforcementGap genérico — ya no aplica a rumbo/radar desde 2026-08-03, ver licenseControl.test.js): stage sigue siendo read_only, targetStatus null', () => {
  const cfgSinReadOnly = { ...CFG, readOnlyStatus: null }
  const lic = { plan: 'pro', status: 'active', current_period_end: '2026-07-26T00:00:00Z' }
  assert.deepEqual(computePortfolioLifecycleStage(lic, cfgSinReadOnly, NOW), { stage: 'read_only', targetStatus: null })
})

test('día 15 (acumulado): blocked', () => {
  const lic = { plan: 'pro', status: 'view_only', current_period_end: '2026-07-19T00:00:00Z' } // 15 días vencido
  assert.deepEqual(computePortfolioLifecycleStage(lic, CFG, NOW), { stage: 'blocked', targetStatus: 'suspended' })
})

test('día 30 (acumulado): inactive, targetStatus = cfg.blockedStatus (bookkeeping interno pero igual asegura el bloqueo)', () => {
  const lic = { plan: 'pro', status: 'suspended', current_period_end: '2026-07-04T00:00:00Z' } // 30 días vencido
  assert.deepEqual(computePortfolioLifecycleStage(lic, CFG, NOW), { stage: 'inactive', targetStatus: CFG.blockedStatus })
})

test('día 45 (acumulado): deletion_eligible, targetStatus = cfg.blockedStatus', () => {
  const lic = { plan: 'pro', status: 'suspended', current_period_end: '2026-06-19T00:00:00Z' } // 45 días vencido
  assert.deepEqual(computePortfolioLifecycleStage(lic, CFG, NOW), { stage: 'deletion_eligible', targetStatus: CFG.blockedStatus })
})

test('día 30, tenant observado por primera vez ya muy vencido (nunca pasó por blocked): targetStatus sigue siendo cfg.blockedStatus', () => {
  // Simula un tenant que arrancó en 'active' (nunca escrito a 'suspended' porque
  // el cron recién arranca / el bridge estuvo caído / onboarding a mitad de ciclo).
  const lic = { plan: 'pro', status: 'active', current_period_end: '2026-07-04T00:00:00Z' } // 30 días vencido
  assert.deepEqual(computePortfolioLifecycleStage(lic, CFG, NOW), { stage: 'inactive', targetStatus: 'suspended' })
})

test('emailKindForStage: mapea read_only/blocked/inactive, deletion_eligible no manda correo al tenant', () => {
  assert.equal(emailKindForStage('read_only'), 'license_read_only')
  assert.equal(emailKindForStage('blocked'), 'license_blocked')
  assert.equal(emailKindForStage('inactive'), 'license_inactive_warning')
  assert.equal(emailKindForStage('deletion_eligible'), null)
})

// ── filterPaidLicenses: gate del ciclo unificado (movido desde
// api/cron/license-lifecycle.test.js — ver final-review-fix-report.md,
// tests originales sin cambios, solo relocalizados) ──────────────────────────

test('filterPaidLicenses: deja pasar solo planes en cfg.lifecycle.paidPlanValues', () => {
  const cfg = licenseControlFor('rumbo')
  const lics = [
    { external_id: 't1', plan: 'trial', status: 'active', current_period_end: '2026-01-01T00:00:00Z' },
    { external_id: 't2', plan: 'starter', status: 'active', current_period_end: '2026-01-01T00:00:00Z' },
    { external_id: 't3', plan: 'founder', status: 'active', current_period_end: '2026-01-01T00:00:00Z' },
  ]
  const out = filterPaidLicenses(lics, cfg)
  assert.deepEqual(out.map((l) => l.external_id), ['t2'])
})

test('un tenant Rumbo en plan trial, muy vencido, queda excluido del ciclo unificado (aunque computePortfolioLifecycleStage por sí solo lo aceptaría)', () => {
  const cfg = licenseControlFor('rumbo')
  const now = new Date('2026-08-03T00:00:00Z')
  // 6 días vencido — confirmado en producción (ver task 3 del final review).
  const trialLic = { external_id: 'trial-tenant', plan: 'trial', status: 'active', current_period_end: '2026-07-28T00:00:00Z' }

  // Sin el filtro de paidPlanValues, computePortfolioLifecycleStage por sí
  // sola NO excluye 'trial' (solo excluye 'founder') — de ahí el bug: aunque
  // 6 días vencido está dentro del período de gracia (día 8), esto demuestra
  // que la única barrera contra un plan 'trial' vencido es el filtro nuevo.
  assert.equal(computePortfolioLifecycleStage(trialLic, cfg.lifecycle, now), null) // dentro de gracia igual

  // Con un vencimiento mucho más viejo (muy pasado el día 15), sin filtro SÍ
  // entraría al ciclo — filterPaidLicenses es lo único que lo detiene antes
  // de siquiera llamar a computePortfolioLifecycleStage.
  const overdueTrialLic = { ...trialLic, current_period_end: '2026-06-01T00:00:00Z' } // ~63 días vencido
  assert.notEqual(computePortfolioLifecycleStage(overdueTrialLic, cfg.lifecycle, now), null) // la etapa pura sí lo tomaría
  assert.deepEqual(filterPaidLicenses([overdueTrialLic], cfg), []) // pero el filtro del cron lo excluye antes de llegar ahí
})

test('un tenant Rumbo pagado (starter) muy vencido SÍ pasa el filtro y sí entra al ciclo', () => {
  const cfg = licenseControlFor('rumbo')
  const now = new Date('2026-08-03T00:00:00Z')
  const lic = { external_id: 'paid-tenant', plan: 'starter', status: 'active', current_period_end: '2026-06-01T00:00:00Z' }
  assert.deepEqual(filterPaidLicenses([lic], cfg), [lic])
  assert.notEqual(computePortfolioLifecycleStage(lic, cfg.lifecycle, now), null)
})
