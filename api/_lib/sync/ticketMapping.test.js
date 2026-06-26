import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mapTicketRecord, isTicketMappable } from './ticketMapping.js'

const PUNTOS = { id: 'puntos' }
const RUMBO = { id: 'rumbo' }
const LIUMA = { id: 'liuma' }

test('maps a puntos SupportTicket to a bodega row', () => {
  const { ticket, tenantExternalId } = mapTicketRecord({
    id: 'tk1', business_id: 'b9', subject: 'No imprime', status: 'open', priority: 'high',
    created_by_email: 'dueno@cafe.mx', last_message_at: '2026-06-20T10:00:00Z',
  }, PUNTOS)
  assert.equal(ticket.external_id, 'tk1')
  assert.equal(tenantExternalId, 'b9')
  assert.equal(ticket.subject, 'No imprime')
  assert.equal(ticket.status, 'open')
  assert.equal(ticket.priority, 'high')
  assert.equal(ticket.requester.email, 'dueno@cafe.mx')
  assert.equal(ticket.last_activity_at, '2026-06-20T10:00:00.000Z') // from last_message_at
})

test('maps a rumbo SupportTicket (tenant_id FK, last_activity_at)', () => {
  const { ticket, tenantExternalId } = mapTicketRecord({
    id: 'r1', tenant_id: 't2', subject: 'Duda', status: 'in_progress', priority: 'normal',
    requester_name: 'Ana', requester_email: 'ana@flota.mx', last_activity_at: '2026-06-25T08:00:00Z',
  }, RUMBO)
  assert.equal(tenantExternalId, 't2')
  assert.equal(ticket.requester.name, 'Ana')
  assert.equal(ticket.requester.email, 'ana@flota.mx')
  assert.equal(ticket.last_activity_at, '2026-06-25T08:00:00.000Z')
})

test('maps a liuma SupportTicket (school_id FK, UPPERCASE status, no requester email)', () => {
  const { ticket, tenantExternalId } = mapTicketRecord({
    id: 'L1', school_id: 'sch3', subject: 'Acceso', status: 'ESCALATED', priority: 'URGENT',
    requester_name: 'Director',
  }, LIUMA)
  assert.equal(tenantExternalId, 'sch3')
  assert.equal(ticket.status, 'ESCALATED')
  assert.equal(ticket.requester.name, 'Director')
  assert.equal(ticket.requester.email, undefined) // liuma has no requester email field
})

test('isTicketMappable requires an id', () => {
  assert.equal(isTicketMappable({ id: 'a' }), true)
  assert.equal(isTicketMappable({}), false)
  assert.equal(isTicketMappable({ id: '' }), false)
})
