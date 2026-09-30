// The panel's ticket catalog is a hand copy of api/_lib/ticketControl.js. These
// tests keep them together: a server app the panel doesn't know is a ticket
// operators can read but not close, which is exactly how 6 of 11 apps ended up.
import test from 'node:test'
import assert from 'node:assert/strict'
import { TICKET_CATALOG, isOpenTicket } from './ticketCatalog.js'
import { ticketApps, ticketStatusesFor, ticketControlFor } from '../../api/_lib/ticketControl.js'

test('the panel knows every app the server syncs tickets for', () => {
  assert.deepEqual(Object.keys(TICKET_CATALOG).sort(), ticketApps().sort())
})

test('same statuses as the server, so a status change is never rejected', () => {
  for (const id of ticketApps()) {
    assert.deepEqual(TICKET_CATALOG[id].statuses, ticketStatusesFor(id), `statuses differ for ${id}`)
  }
})

test('"Cerrar ticket" writes a real, terminal status of that app', () => {
  for (const [id, c] of Object.entries(TICKET_CATALOG)) {
    assert.ok(c.statuses.includes(c.closeStatus), `${id}: ${c.closeStatus} is not one of its statuses`)
    assert.equal(isOpenTicket(c.closeStatus), false, `${id}: closing would leave it counted as open`)
  }
})

test('the reply box is offered only where the server can post a reply', () => {
  for (const id of ticketApps()) {
    assert.equal(TICKET_CATALOG[id].canReply, Boolean(ticketControlFor(id).thread), `canReply differs for ${id}`)
  }
})

test('every app has at least one open status, and opening states count as open', () => {
  for (const [id, c] of Object.entries(TICKET_CATALOG)) {
    assert.ok(c.statuses.some(isOpenTicket), `${id} has no open status`)
  }
  // ctrlhq/kitchops open as `submitted`; the old allowlist missed it.
  assert.equal(isOpenTicket('submitted'), true)
  assert.equal(isOpenTicket('abierto'), true)
  assert.equal(isOpenTicket('CLOSED'), false)
})
