// api/_lib/portfolioLifecycle.test.js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { computePortfolioLifecycleStage, emailKindForStage } from './portfolioLifecycle.js'

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

test('día 8, app sin read-only en su schema (rumbo/radar): stage sigue siendo read_only, targetStatus null', () => {
  const cfgSinReadOnly = { ...CFG, readOnlyStatus: null }
  const lic = { plan: 'pro', status: 'active', current_period_end: '2026-07-26T00:00:00Z' }
  assert.deepEqual(computePortfolioLifecycleStage(lic, cfgSinReadOnly, NOW), { stage: 'read_only', targetStatus: null })
})

test('día 15 (acumulado): blocked', () => {
  const lic = { plan: 'pro', status: 'view_only', current_period_end: '2026-07-19T00:00:00Z' } // 15 días vencido
  assert.deepEqual(computePortfolioLifecycleStage(lic, CFG, NOW), { stage: 'blocked', targetStatus: 'suspended' })
})

test('día 30 (acumulado): inactive, sin targetStatus (bookkeeping interno, no se escribe al app)', () => {
  const lic = { plan: 'pro', status: 'suspended', current_period_end: '2026-07-04T00:00:00Z' } // 30 días vencido
  assert.deepEqual(computePortfolioLifecycleStage(lic, CFG, NOW), { stage: 'inactive', targetStatus: null })
})

test('día 45 (acumulado): deletion_eligible, sin targetStatus', () => {
  const lic = { plan: 'pro', status: 'suspended', current_period_end: '2026-06-19T00:00:00Z' } // 45 días vencido
  assert.deepEqual(computePortfolioLifecycleStage(lic, CFG, NOW), { stage: 'deletion_eligible', targetStatus: null })
})

test('emailKindForStage: mapea read_only/blocked/inactive, deletion_eligible no manda correo al tenant', () => {
  assert.equal(emailKindForStage('read_only'), 'license_read_only')
  assert.equal(emailKindForStage('blocked'), 'license_blocked')
  assert.equal(emailKindForStage('inactive'), 'license_inactive_warning')
  assert.equal(emailKindForStage('deletion_eligible'), null)
})
