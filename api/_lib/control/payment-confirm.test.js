import { test } from 'node:test'
import assert from 'node:assert/strict'
import { assertConfirmable, evaluateClaim, buildRollbackFailureLog } from './payment-confirm.js'

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

// evaluateClaim guards the atomic `.eq('confirmed_at', null)` claim update:
// Supabase's `.update(...).select()` returns the rows that actually matched
// (and were updated), so an empty array means someone else won the race
// (or the row doesn't exist) between our read and our write.
test('evaluateClaim: rechaza cuando el update no afectó ninguna fila (perdió la carrera)', () => {
  const r = evaluateClaim([])
  assert.equal(r.ok, false)
  assert.equal(r.error, 'already_confirmed')
})

test('evaluateClaim: rechaza null/undefined igual que un array vacío', () => {
  assert.equal(evaluateClaim(null).ok, false)
  assert.equal(evaluateClaim(null).error, 'already_confirmed')
  assert.equal(evaluateClaim(undefined).ok, false)
})

test('evaluateClaim: acepta cuando el update afectó exactamente la fila reclamada', () => {
  const r = evaluateClaim([{ id: 'report-1', confirmed_at: '2026-08-03T00:00:00Z' }])
  assert.equal(r.ok, true)
})

// buildRollbackFailureLog covers the worst-case branch: callBridge failed AND
// the rollback of the atomic claim also failed, so the report is left stuck
// with confirmed_at set (assertConfirmable rejects any retry). This is the
// only trace an operator has, so the message and audit payload must carry
// both the reportId and both underlying error messages.
test('buildRollbackFailureLog: incluye reportId y ambos mensajes de error', () => {
  const info = buildRollbackFailureLog('report-1', 'bridge unreachable', 'db timeout')
  assert.match(info.message, /report-1/)
  assert.match(info.message, /bridge unreachable/)
  assert.match(info.message, /db timeout/)
  assert.deepEqual(info.auditPayload, {
    reportId: 'report-1',
    originalError: 'bridge unreachable',
    rollbackError: 'db timeout',
  })
})
