import { test } from 'node:test'
import assert from 'node:assert/strict'
import { failureAuditFields } from './tickets.js'

// A reply that failed used to leave no row at all, so a lost reply could not be
// told apart from one nobody sent. The failure row must name who, which ticket,
// what was attempted and the error the app (or MC) gave.
test('failureAuditFields: names the operator, the ticket, the op and the error', () => {
  const row = failureAuditFields({
    member: { user_id: 'u1', email: 'ops@acaciaco.com.mx' }, appId: 'sommel', ticketExternalId: 42,
    op: 'reply', status: undefined, code: 502, error: 'field not allowed: foo',
  })
  assert.deepEqual(row, {
    actor: 'u1', actor_email: 'ops@acaciaco.com.mx', target_app: 'sommel', target_id: '42',
    payload: { op: 'reply', status: null, http: 502, error: 'field not allowed: foo' },
  })
})

test('failureAuditFields: caps a long upstream error', () => {
  const row = failureAuditFields({ member: { user_id: 'u1' }, appId: 'x', ticketExternalId: 't', op: 'status', status: 'cerrado', code: 502, error: 'e'.repeat(2000) })
  assert.equal(row.payload.error.length, 500)
  assert.equal(row.payload.status, 'cerrado')
})
