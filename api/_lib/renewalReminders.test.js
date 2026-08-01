import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  currentPeriodKey, endOfMonthUTC, qualifiesForReminder, reminderKindFor, shouldAutoRenew,
  qualifiesForUpcomingReminder, upcomingPeriodKey,
} from './renewalReminders.js'

// Reloj fijo: el cron corre el día 1 a las 15:00 UTC.
const NOW = new Date('2026-07-01T15:00:00Z')

test('currentPeriodKey da el mes en curso (YYYY-MM, UTC)', () => {
  assert.equal(currentPeriodKey(NOW), '2026-07')
})

test('endOfMonthUTC es el primer instante del mes siguiente', () => {
  assert.equal(endOfMonthUTC(NOW), Date.UTC(2026, 7, 1, 0, 0, 0, 0)) // 2026-08-01T00:00:00Z
})

test('califica una licencia vencida', () => {
  assert.equal(qualifiesForReminder({ current_period_end: '2026-06-01T00:00:00Z' }, NOW), true)
})

test('califica una licencia que vence dentro del mes en curso', () => {
  assert.equal(qualifiesForReminder({ current_period_end: '2026-07-20T00:00:00Z' }, NOW), true)
})

test('NO califica una licencia con vencimiento en un mes futuro', () => {
  assert.equal(qualifiesForReminder({ current_period_end: '2026-08-05T00:00:00Z' }, NOW), false)
})

test('NO califica sin vencimiento o con fecha inválida', () => {
  assert.equal(qualifiesForReminder({ current_period_end: null }, NOW), false)
  assert.equal(qualifiesForReminder({}, NOW), false)
  assert.equal(qualifiesForReminder({ current_period_end: 'no-es-fecha' }, NOW), false)
})

test('reminderKindFor: cobro automático → aviso; manual → recordatorio', () => {
  assert.equal(reminderKindFor({ auto_renew: true }), 'renewal_fyi')
  assert.equal(reminderKindFor({ auto_renew: false }), 'renewal')
  assert.equal(reminderKindFor({}), 'renewal')
})

test('shouldAutoRenew: activo con cobro auto sí; suspendido/cancelado/solo-lectura no', () => {
  assert.equal(shouldAutoRenew({ auto_renew: true, status: 'active' }), true)
  assert.equal(shouldAutoRenew({ auto_renew: true, status: 'suspended' }), false)
  assert.equal(shouldAutoRenew({ auto_renew: true, status: 'canceled' }), false)
  assert.equal(shouldAutoRenew({ auto_renew: true, status: 'cancelled' }), false)
  assert.equal(shouldAutoRenew({ auto_renew: true, status: 'view_only' }), false)
  assert.equal(shouldAutoRenew({ auto_renew: false, status: 'active' }), false)
  assert.equal(shouldAutoRenew({}), false)
})

test('qualifiesForUpcomingReminder: pago manual, vence dentro de 7 días → sí', () => {
  assert.equal(qualifiesForUpcomingReminder({ current_period_end: '2026-07-05T00:00:00Z', auto_renew: false }, NOW), true)
  assert.equal(qualifiesForUpcomingReminder({ current_period_end: '2026-07-01T15:00:00Z', auto_renew: false }, NOW), true) // hoy mismo
  assert.equal(qualifiesForUpcomingReminder({ current_period_end: '2026-07-08T15:00:00Z', auto_renew: false }, NOW), true) // exactamente +7d
})

test('qualifiesForUpcomingReminder: NO si ya venció, si es cobro automático, o si vence más allá de 7 días', () => {
  assert.equal(qualifiesForUpcomingReminder({ current_period_end: '2026-06-25T00:00:00Z', auto_renew: false }, NOW), false) // ya venció
  assert.equal(qualifiesForUpcomingReminder({ current_period_end: '2026-07-05T00:00:00Z', auto_renew: true }, NOW), false) // cobro auto ya tiene su aviso
  assert.equal(qualifiesForUpcomingReminder({ current_period_end: '2026-08-01T00:00:00Z', auto_renew: false }, NOW), false) // muy lejos
  assert.equal(qualifiesForUpcomingReminder({ current_period_end: null, auto_renew: false }, NOW), false)
})

test('upcomingPeriodKey: la fecha de vencimiento (no el mes), para deduplicar por ciclo', () => {
  assert.equal(upcomingPeriodKey({ current_period_end: '2026-07-05T00:00:00Z' }), '2026-07-05')
})
