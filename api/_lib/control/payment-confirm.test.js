import { test } from 'node:test'
import assert from 'node:assert/strict'
import { assertConfirmable } from './payment-confirm.js'

test('assertConfirmable: rechaza un reporte ya confirmado', () => {
  const r = assertConfirmable({ confirmed_at: '2026-08-01T00:00:00Z' })
  assert.equal(r.ok, false)
  assert.equal(r.error, 'already_confirmed')
})

test('assertConfirmable: rechaza null (reporte no encontrado)', () => {
  assert.equal(assertConfirmable(null).ok, false)
  assert.equal(assertConfirmable(null).error, 'not_found')
})

test('assertConfirmable: acepta un reporte pendiente', () => {
  assert.equal(assertConfirmable({ confirmed_at: null }).ok, true)
})
