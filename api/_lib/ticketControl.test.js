import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildTicketReply, buildTicketStatus, normalizeMessage, ticketApps } from './ticketControl.js'

const NOW = new Date('2026-06-26T12:00:00Z')
const NOW_ISO = NOW.toISOString()

// ── all 6 apps now persist tickets ───────────────────────────────────────────
test('all portfolio apps have ticket configs', () => {
  assert.deepEqual(ticketApps().sort(), ['flowfin', 'liuma', 'puntos', 'radar', 'rumbo', 'stockflow'])
})

// ── stockflow / flowfin mirror the puntos rich model with a different tenant FK ─
test('stockflow reply: business_id message + rich counters', () => {
  const raw = { id: 's1', business_id: 'b3', status: 'open', messages_count: 0 }
  const out = buildTicketReply('stockflow', { ticketRaw: raw, body: 'hola', actorEmail: 'op@acacia.mx', now: NOW })
  assert.equal(out.message.business_id, 'b3')
  assert.equal(out.message.author_role, 'owner')
  assert.equal(out.message.is_internal_note, false)
  assert.equal(out.patch.status, 'in_progress')
  assert.equal(out.patch.messages_count, 1)
  assert.equal(out.patch.unread_for_tenant, true)
  assert.equal(out.patch.first_response_at, NOW_ISO)
})

test('radar reply: company_id message + rich counters', () => {
  const raw = { id: 'r1', company_id: 'co7', status: 'open', messages_count: 0 }
  const out = buildTicketReply('radar', { ticketRaw: raw, body: 'hola', actorEmail: 'op@acacia.mx', now: NOW })
  assert.equal(out.message.company_id, 'co7')
  assert.equal(out.message.author_role, 'owner')
  assert.equal(out.message.is_internal_note, false)
  assert.equal(out.patch.status, 'in_progress')
  assert.equal(out.patch.messages_count, 1)
  assert.equal(out.patch.unread_for_tenant, true)
  assert.equal(out.patch.first_response_at, NOW_ISO)
})

test('flowfin reply: family_id message + rich counters', () => {
  const raw = { id: 'f1', family_id: 'fam5', status: 'waiting_customer', messages_count: 4, first_response_at: '2026-01-01T00:00:00Z' }
  const out = buildTicketReply('flowfin', { ticketRaw: raw, body: 'seguimiento', now: NOW })
  assert.equal(out.message.family_id, 'fam5')
  assert.equal(out.message.author_role, 'owner')
  assert.equal(out.patch.status, 'waiting_customer')          // not open → unchanged
  assert.equal(out.patch.messages_count, 5)
  assert.equal(out.patch.first_response_at, '2026-01-01T00:00:00Z') // preserved
})

test('stockflow/flowfin status resolved/closed stamp timestamps', () => {
  assert.equal(buildTicketStatus('stockflow', { ticketRaw: { id: 's1', status: 'open' }, status: 'resolved', now: NOW }).patch.resolved_at, NOW_ISO)
  assert.equal(buildTicketStatus('flowfin', { ticketRaw: { id: 'f1', status: 'open' }, status: 'closed', now: NOW }).patch.closed_at, NOW_ISO)
})

// ── puntos reply: message entity + counters + first response + status bump ──
test('puntos reply creates an owner message and bumps ticket counters', () => {
  const raw = { id: 'tk1', business_id: 'b9', status: 'open', messages_count: 2, first_response_at: null }
  const out = buildTicketReply('puntos', { ticketRaw: raw, body: '  hola  ', actorEmail: 'op@acacia.mx', now: NOW })
  assert.equal(out.messageEntity, 'SupportTicketMessage')
  assert.deepEqual(out.message, {
    ticket_id: 'tk1', author_role: 'owner', body: 'hola', business_id: 'b9',
    author_email: 'op@acacia.mx', author_name: 'ACACIA Soporte', is_internal_note: false,
  })
  assert.equal(out.patch.status, 'in_progress')          // open → in_progress
  assert.equal(out.patch.messages_count, 3)              // 2 + 1
  assert.equal(out.patch.last_message_by_role, 'owner')
  assert.equal(out.patch.unread_for_tenant, true)
  assert.equal(out.patch.first_response_at, NOW_ISO)     // set on first reply
})

test('puntos reply keeps a non-open status and preserves existing first_response_at', () => {
  const raw = { id: 'tk1', business_id: 'b9', status: 'waiting_customer', messages_count: 5, first_response_at: '2026-01-01T00:00:00Z' }
  const out = buildTicketReply('puntos', { ticketRaw: raw, body: 'seguimiento', now: NOW })
  assert.equal(out.patch.status, 'waiting_customer')
  assert.equal(out.patch.first_response_at, '2026-01-01T00:00:00Z')
  assert.equal(out.patch.messages_count, 6)
})

// ── liuma reply: OWNER role + requester_user_id denormalized, UPPERCASE status ─
test('liuma reply uses OWNER role and denormalizes requester_user_id', () => {
  const raw = { id: 'L1', school_id: 'sch3', status: 'OPEN', requester_user_id: 'u7' }
  const out = buildTicketReply('liuma', { ticketRaw: raw, body: 'respuesta', now: NOW })
  assert.equal(out.message.author_role, 'OWNER')
  assert.equal(out.message.school_id, 'sch3')
  assert.equal(out.message.requester_user_id, 'u7')
  assert.equal(out.patch.status, 'IN_PROGRESS')
})

// ── rumbo reply: inline append to responses[] + last_activity_at ─────────────
test('rumbo reply appends to inline responses and passes the current array', () => {
  const raw = { id: 'r1', tenant_id: 't2', status: 'open', responses: [{ author_role: 'requester', body: 'hi', created_at: '2026-06-01T00:00:00Z' }] }
  const out = buildTicketReply('rumbo', { ticketRaw: raw, body: 'claro', now: NOW })
  assert.equal(out.appendField, 'responses')
  assert.deepEqual(out.appendItem, { author_name: 'ACACIA Soporte', author_role: 'support', body: 'claro', created_at: NOW_ISO })
  assert.equal(out.currentArray.length, 1)              // snapshot fallback for the bridge
  assert.equal(out.patch.last_activity_at, NOW_ISO)
  assert.equal(out.patch.status, 'in_progress')
  assert.equal(out.messageEntity, undefined)            // no separate message entity
})

test('empty reply body is rejected', () => {
  assert.ok(buildTicketReply('puntos', { ticketRaw: { id: 'x', status: 'open' }, body: '   ' }).error)
})

// ── status changes stamp the right timestamps per app ───────────────────────
test('puntos status resolved/closed stamp resolved_at/closed_at', () => {
  const raw = { id: 'tk1', status: 'in_progress' }
  assert.equal(buildTicketStatus('puntos', { ticketRaw: raw, status: 'resolved', now: NOW }).patch.resolved_at, NOW_ISO)
  assert.equal(buildTicketStatus('puntos', { ticketRaw: raw, status: 'closed', now: NOW }).patch.closed_at, NOW_ISO)
})

test('liuma RESOLVED stamps resolved_at; CLOSED has no closed_at field', () => {
  const raw = { id: 'L1', status: 'IN_PROGRESS' }
  assert.equal(buildTicketStatus('liuma', { ticketRaw: raw, status: 'RESOLVED', now: NOW }).patch.resolved_at, NOW_ISO)
  const closed = buildTicketStatus('liuma', { ticketRaw: raw, status: 'CLOSED', now: NOW }).patch
  assert.equal(closed.status, 'CLOSED')
  assert.equal(closed.closed_at, undefined)
})

test('rumbo status only sets status + last_activity_at (no resolved_at/closed_at)', () => {
  const out = buildTicketStatus('rumbo', { ticketRaw: { id: 'r1', status: 'open' }, status: 'resolved', now: NOW })
  assert.deepEqual(out.patch, { status: 'resolved', last_activity_at: NOW_ISO })
})

test('invalid status is rejected', () => {
  assert.ok(buildTicketStatus('puntos', { ticketRaw: { id: 'x' }, status: 'frobnicated' }).error)
  assert.ok(buildTicketStatus('liuma', { ticketRaw: { id: 'x' }, status: 'open' }).error) // lowercase invalid for liuma
})

// ── normalizeMessage marks staff vs customer correctly per app ──────────────
test('normalizeMessage flags staff by each app author role', () => {
  assert.equal(normalizeMessage('puntos', { author_role: 'owner', body: 'a' }).staff, true)
  assert.equal(normalizeMessage('puntos', { author_role: 'tenant', body: 'a' }).staff, false)
  assert.equal(normalizeMessage('liuma', { author_role: 'OWNER', body: 'a' }).staff, true)
  assert.equal(normalizeMessage('liuma', { author_role: 'REQUESTER', body: 'a' }).staff, false)
  assert.equal(normalizeMessage('rumbo', { author_role: 'support', body: 'a' }).staff, true)
  assert.equal(normalizeMessage('rumbo', { author_role: 'requester', body: 'a' }).staff, false)
})
