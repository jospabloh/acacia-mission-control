import { test } from 'node:test'
import assert from 'node:assert/strict'
import { computeLifecycleTransition, reminderKindFor, weekBucketKey } from './licenseLifecycle.js'

const CFG = {
  paidPlanValues: ['premium'],
  graceDaysToReadOnly: 15,
  graceDaysToAccessDenied: 15,
  graceDaysToDeletionEligible: 30,
  sinceFields: { read_only: 'read_only_since', access_denied: 'access_denied_since', deletion_eligible: 'deletion_eligible_since' },
  exportConfirmedField: 'export_confirmed_at',
  periodEndField: 'premium_period_end_at',
}
const NOW = new Date('2026-08-01T00:00:00Z')

test('plan free nunca transiciona, sin importar el estado', () => {
  const lic = { plan: 'free', status: 'active', premium_period_end_at: '2026-01-01T00:00:00Z' }
  assert.equal(computeLifecycleTransition(lic, CFG, NOW), null)
})

test('active sin premium_period_end_at no transiciona (nunca se activó Premium con fecha)', () => {
  const lic = { plan: 'premium', status: 'active', premium_period_end_at: null }
  assert.equal(computeLifecycleTransition(lic, CFG, NOW), null)
})

test('active dentro del período de gracia no transiciona', () => {
  // Venció hace 10 días, gracia es 15 → aún no.
  const lic = { plan: 'premium', status: 'active', premium_period_end_at: '2026-07-22T00:00:00Z' }
  assert.equal(computeLifecycleTransition(lic, CFG, NOW), null)
})

test('active → read_only tras 15 días vencido', () => {
  // Venció hace 16 días.
  const lic = { plan: 'premium', status: 'active', premium_period_end_at: '2026-07-16T00:00:00Z' }
  assert.deepEqual(computeLifecycleTransition(lic, CFG, NOW), { toStatus: 'read_only', sinceField: 'read_only_since' })
})

test('read_only dentro de su propio plazo no transiciona', () => {
  const lic = { plan: 'premium', status: 'read_only', read_only_since: '2026-07-25T00:00:00Z' } // 7 días
  assert.equal(computeLifecycleTransition(lic, CFG, NOW), null)
})

test('read_only → access_denied tras 15 días en ese estado', () => {
  const lic = { plan: 'premium', status: 'read_only', read_only_since: '2026-07-10T00:00:00Z' } // 22 días
  assert.deepEqual(computeLifecycleTransition(lic, CFG, NOW), { toStatus: 'access_denied', sinceField: 'access_denied_since' })
})

test('access_denied con exportación ya confirmada nunca avanza a deletion_eligible', () => {
  const lic = { plan: 'premium', status: 'access_denied', access_denied_since: '2026-05-01T00:00:00Z', export_confirmed_at: '2026-06-01T00:00:00Z' }
  assert.equal(computeLifecycleTransition(lic, CFG, NOW), null)
})

test('access_denied sin exportación → deletion_eligible tras 30 días', () => {
  const lic = { plan: 'premium', status: 'access_denied', access_denied_since: '2026-06-01T00:00:00Z', export_confirmed_at: null } // 61 días
  assert.deepEqual(computeLifecycleTransition(lic, CFG, NOW), { toStatus: 'deletion_eligible', sinceField: 'deletion_eligible_since' })
})

test('deletion_eligible ya seteado no se re-dispara (una sola vez)', () => {
  const lic = { plan: 'premium', status: 'access_denied', access_denied_since: '2026-01-01T00:00:00Z', export_confirmed_at: null, deletion_eligible_since: '2026-07-01T00:00:00Z' }
  assert.equal(computeLifecycleTransition(lic, CFG, NOW), null)
})

test('deletion_eligible no transiciona más (estado terminal hasta acción humana)', () => {
  const lic = { plan: 'premium', status: 'deletion_eligible', deletion_eligible_since: '2026-01-01T00:00:00Z' }
  assert.equal(computeLifecycleTransition(lic, CFG, NOW), null)
})

test('reminderKindFor: read_only y access_denied mandan tipos distintos, el resto ninguno', () => {
  assert.equal(reminderKindFor('read_only'), 'premium_read_only_reminder')
  assert.equal(reminderKindFor('access_denied'), 'premium_access_denied_reminder')
  assert.equal(reminderKindFor('active'), null)
  assert.equal(reminderKindFor('deletion_eligible'), null) // ya está en revisión humana, sin más recordatorios automáticos
})

test('weekBucketKey: mismo lunes UTC para toda la semana', () => {
  // 2026-08-01 es sábado; el lunes de esa semana es 2026-07-27.
  assert.equal(weekBucketKey(new Date('2026-08-01T23:00:00Z')), '2026-07-27')
  assert.equal(weekBucketKey(new Date('2026-07-27T00:00:00Z')), '2026-07-27')
  assert.equal(weekBucketKey(new Date('2026-08-02T00:00:00Z')), '2026-07-27') // domingo, misma semana
})
