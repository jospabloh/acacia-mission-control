// The panel's ticket catalog is a hand copy of api/_lib/ticketControl.js. These
// tests keep them together: a server app the panel doesn't know is a ticket
// operators can read but not close, which is exactly how 6 of 11 apps ended up.
import test from 'node:test'
import assert from 'node:assert/strict'
import { TICKET_CATALOG, OPEN_TICKETS_FILTER, TERMINAL_STATUSES, compareByUrgency, fmtDuration, isOpenTicket, slaProgress } from './ticketCatalog.js'
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

test('the open filter runs in the query and keeps NULL statuses', () => {
  // Filtering after .limit(500) dropped old open tickets once closed history
  // piled up; the predicate has to reach PostgREST. NULL NOT IN (...) is NULL,
  // so without the is.null branch a ticket with no status would vanish.
  assert.equal(OPEN_TICKETS_FILTER, `status.is.null,status.not.in.(${TERMINAL_STATUSES.join(',')})`)
  for (const s of TERMINAL_STATUSES) assert.equal(isOpenTicket(s), false)
})

test('urgency: the longest-overdue ticket comes first, not the newest', () => {
  const now = Date.parse('2026-10-01T12:00:00Z')
  const rows = [
    { id: 'fresh-overdue', sla_resolve_due_at: '2026-10-01T11:00:00Z', created_at: '2026-09-30T00:00:00Z' },
    { id: 'on-time', sla_resolve_due_at: '2026-10-03T00:00:00Z', created_at: '2026-10-01T00:00:00Z' },
    { id: 'no-sla', sla_resolve_due_at: null, created_at: '2026-09-01T00:00:00Z' },
    { id: 'days-overdue', sla_resolve_due_at: '2026-09-27T00:00:00Z', created_at: '2026-09-20T00:00:00Z' },
    { id: 'on-time-sooner', sla_resolve_due_at: '2026-10-02T00:00:00Z', created_at: '2026-10-01T06:00:00Z' },
  ]
  const order = [...rows].sort((a, b) => compareByUrgency(a, b, now)).map((r) => r.id)
  assert.deepEqual(order, ['days-overdue', 'fresh-overdue', 'on-time-sooner', 'on-time', 'no-sla'])
})

test('slaProgress: the bar fills with the share of the resolve SLA already used', () => {
  // 24 h SLA, 6 h in → a quarter used. The bar is about time against the
  // promise, so it must start at the customer's creation, not when MC saw it.
  const row = { status: 'abierto', customer_created_at: '2026-10-01T00:00:00Z', created_at: '2026-10-01T05:00:00Z', sla_resolve_due_at: '2026-10-02T00:00:00Z' }
  const p = slaProgress(row, Date.parse('2026-10-01T06:00:00Z'))
  assert.equal(p.used, 0.25)
  assert.equal(p.overdue, false)
})

test('slaProgress: overdue caps at full and says so', () => {
  const row = { status: 'open', created_at: '2026-10-01T00:00:00Z', sla_resolve_due_at: '2026-10-01T04:00:00Z' }
  const p = slaProgress(row, Date.parse('2026-10-01T09:00:00Z'))
  assert.equal(p.used, 1)
  assert.equal(p.overdue, true)
})

test('slaProgress: no clock for closed tickets or missing times', () => {
  const base = { created_at: '2026-10-01T00:00:00Z', sla_resolve_due_at: '2026-10-01T04:00:00Z' }
  assert.equal(slaProgress({ ...base, status: 'cerrado' }), null)
  assert.equal(slaProgress({ ...base, status: 'open', sla_resolve_due_at: null }), null)
  assert.equal(slaProgress({ status: 'open', created_at: 'x', sla_resolve_due_at: base.sla_resolve_due_at }), null)
})

test('fmtDuration', () => {
  assert.equal(fmtDuration(45 * 60000), '45m')
  assert.equal(fmtDuration(-(3 * 60 + 20) * 60000), '3h 20m')
  assert.equal(fmtDuration((26 * 60) * 60000), '1d 2h')
})
