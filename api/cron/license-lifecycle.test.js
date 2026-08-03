// api/cron/license-lifecycle.test.js
// Cobertura pura del filtro paidPlanValues que gatea la rama unificada
// (runUnifiedLifecycleForApp) — ver filterPaidLicenses. No ejercita el
// handler completo (usa supabaseAdmin/callBridge, requiere DB/red real).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { filterPaidLicenses } from './license-lifecycle.js'
import { licenseControlFor } from '../_lib/licenseControl.js'
import { computePortfolioLifecycleStage } from '../_lib/portfolioLifecycle.js'

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
