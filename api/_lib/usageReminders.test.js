import { test } from 'node:test'
import assert from 'node:assert/strict'
import { qualifiesForUsageReminder, usagePeriodKey, HAS_NATIVE_REENGAGEMENT } from './usageReminders.js'

const NOW = new Date('2026-08-01T09:00:00Z')
const OLD_TENANT = { external_id: 't1', created_at: '2026-01-01T00:00:00Z' }

test('usagePeriodKey da el mes en curso (YYYY-MM, UTC)', () => {
  assert.equal(usagePeriodKey(NOW), '2026-08')
})

test('califica: tenant activo, viejo, sin actividad sellada hace >21 días', () => {
  const tenant = { ...OLD_TENANT, last_seen_active_at: '2026-06-01T00:00:00Z' }
  assert.equal(qualifiesForUsageReminder({ tenant, license: { status: 'active' }, now: NOW }), true)
})

test('califica: sin last_seen_active_at nunca, pero de alta hace tiempo → cuenta desde el alta', () => {
  const tenant = { external_id: 't2', created_at: '2026-05-01T00:00:00Z' } // >21 días atrás, sin sesiones jamás
  assert.equal(qualifiesForUsageReminder({ tenant, license: { status: 'active' }, now: NOW }), true)
})

test('NO califica: activo hace menos de 21 días', () => {
  const tenant = { ...OLD_TENANT, last_seen_active_at: '2026-07-25T00:00:00Z' }
  assert.equal(qualifiesForUsageReminder({ tenant, license: { status: 'active' }, now: NOW }), false)
})

test('NO califica: tenant recién dado de alta (dentro del período de gracia), aunque no tenga actividad', () => {
  const tenant = { external_id: 't3', created_at: '2026-07-28T00:00:00Z' }
  assert.equal(qualifiesForUsageReminder({ tenant, license: { status: 'active' }, now: NOW }), false)
})

test('NO califica: licencia suspendida / solo lectura / acceso denegado — ya tiene su propio recordatorio', () => {
  const tenant = { ...OLD_TENANT, last_seen_active_at: '2026-06-01T00:00:00Z' }
  for (const status of ['suspended', 'view_only', 'access_denied', 'read_only', 'canceled', 'deletion_eligible']) {
    assert.equal(qualifiesForUsageReminder({ tenant, license: { status }, now: NOW }), false, `status=${status}`)
  }
})

test('NO califica: sin ninguna fecha de referencia (ni sesión sellada ni alta) — no arriesgar', () => {
  const tenant = { external_id: 't4' }
  assert.equal(qualifiesForUsageReminder({ tenant, license: { status: 'active' }, now: NOW }), false)
})

test('created_date de Base44 (raw) tiene prioridad sobre created_at de Mission Control', () => {
  // raw.created_date reciente (dentro del período de gracia) debe ganarle a un
  // created_at de MC viejo (p.ej. onboarding tardío del registry).
  const tenant = { external_id: 't5', created_at: '2026-01-01T00:00:00Z', raw: { created_date: '2026-07-29T00:00:00Z' } }
  assert.equal(qualifiesForUsageReminder({ tenant, license: { status: 'active' }, now: NOW }), false)
})

test('HAS_NATIVE_REENGAGEMENT: puntos tiene su propio job (cleanupInactiveUsers) — Mission Control se abstiene', () => {
  assert.ok(HAS_NATIVE_REENGAGEMENT.has('puntos'))
  assert.equal(HAS_NATIVE_REENGAGEMENT.has('flowfin'), false)
})
