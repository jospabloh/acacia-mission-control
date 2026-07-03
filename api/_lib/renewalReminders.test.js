import { test } from 'node:test'
import assert from 'node:assert/strict'
import { currentPeriodKey, endOfMonthUTC, qualifiesForReminder, reminderKindFor } from './renewalReminders.js'

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
