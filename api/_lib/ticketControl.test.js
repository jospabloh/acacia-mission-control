import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildTicketReply, buildTicketStatus, newCustomerReplies, normalizeMessage, originalMessageThread, ticketApps } from './ticketControl.js'

const NOW = new Date('2026-06-26T12:00:00Z')
const NOW_ISO = NOW.toISOString()

// ── every app that persists tickets ──────────────────────────────────────────
test('all portfolio apps have ticket configs', () => {
  assert.deepEqual(ticketApps().sort(), ['artiskids', 'cateqhub', 'ctrlhq', 'flowfin', 'kitchops', 'liuma', 'puntos', 'radar', 'rumbo', 'sommel', 'stockflow'])
})

// ── artiskids: status changes work, replies don't (no thread entity yet) ────
test('artiskids resolver estampa status pero no resolved_at (no tiene ese campo)', () => {
  const out = buildTicketStatus('artiskids', { ticketRaw: { id: 'ak1' }, status: 'resolved', now: NOW })
  assert.equal(out.patch.status, 'resolved')
  assert.equal(out.patch.resolved_at, undefined)
})

test('artiskids reply se rechaza: no tiene thread', () => {
  const out = buildTicketReply('artiskids', { ticketRaw: { id: 'ak1', family_id: 'fam1', status: 'open' }, body: 'hola', actorEmail: 'op@acacia.mx', now: NOW })
  assert.match(out.error, /no soporta respuestas/)
})

// ── kitchops: four states with a real resolved_at, unlike ctrlhq's two ───────
test('kitchops reply escala submitted → in_progress y estampa el hilo', () => {
  const raw = { id: 'kt1', business_id: 'biz9', status: 'submitted' }
  const out = buildTicketReply('kitchops', { ticketRaw: raw, body: 'ya lo vimos', actorEmail: 'op@acacia.mx', now: NOW })
  assert.equal(out.messageEntity, 'SupportTicketMessage')
  assert.equal(out.message.ticket_id, 'kt1')
  assert.equal(out.message.business_id, 'biz9')
  // 'owner' (not ctrlhq's 'acacia_staff') — KitchOps' SupportTicketMessage
  // enum is owner|tenant, and the field is admin-write-locked on its side.
  assert.equal(out.message.author_role, 'owner')
  assert.equal(out.patch.status, 'in_progress')
})

test('kitchops resolver estampa resolved_at', () => {
  const out = buildTicketStatus('kitchops', { ticketRaw: { id: 'kt1' }, status: 'resolved', now: NOW })
  assert.equal(out.patch.status, 'resolved')
  assert.equal(out.patch.resolved_at, NOW_ISO)
})

// ── ctrlhq reply: simple 2-state model (no rich counters, no separate
// in_progress status) ────────────────────────────────────────────────────────
test('ctrlhq reply creates an acacia_staff message, status stays submitted', () => {
  const raw = { id: 'ck1', business_id: 'biz1', status: 'submitted' }
  const out = buildTicketReply('ctrlhq', { ticketRaw: raw, body: 'hola', actorEmail: 'op@acacia.mx', now: NOW })
  assert.equal(out.messageEntity, 'SupportTicketMessage')
  assert.equal(out.message.ticket_id, 'ck1')
  assert.equal(out.message.business_id, 'biz1')
  assert.equal(out.message.author_role, 'acacia_staff')
  assert.equal(out.message.body, 'hola')
  assert.equal(out.patch.status, 'submitted') // openStatus === inProgressStatus for ctrlhq
})

test('ctrlhq status resolved does not stamp a timestamp field (none modeled yet)', () => {
  const out = buildTicketStatus('ctrlhq', { ticketRaw: { id: 'ck1', status: 'submitted' }, status: 'resolved', now: NOW })
  assert.deepEqual(out.patch, { status: 'resolved' })
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

// ── apps without a thread: the original message is the conversation ─────────
test('originalMessageThread devuelve el mensaje del cliente (sommel: body)', () => {
  const out = originalMessageThread({ body: 'No imprime', created_by_email: 'a@b.mx', created_date: '2026-09-30T20:00:00Z' })
  assert.deepEqual(out, [{ staff: false, name: 'a@b.mx', body: 'No imprime', ts: '2026-09-30T20:00:00Z' }])
})

test('originalMessageThread lee `message` (artiskids) y no inventa nada si no hay texto', () => {
  assert.equal(originalMessageThread({ message: 'Hola' })[0].body, 'Hola')
  assert.deepEqual(originalMessageThread({}), [])
  assert.deepEqual(originalMessageThread(null), [])
})

// ── sommel: conversation inline in responses[] ───────────────────────────────
test('sommel responde como acacia en responses[] y pasa de abierto a en_proceso', () => {
  const out = buildTicketReply('sommel', { ticketRaw: { id: 's1', status: 'abierto', responses: [] }, body: 'Ya quedó', actorEmail: 'op@acacia.mx', now: NOW })
  assert.equal(out.error, undefined)
  assert.equal(out.appendField, 'responses')
  assert.deepEqual(out.appendItem, { author_name: 'ACACIA Soporte', author_role: 'acacia', body: 'Ya quedó', created_at: NOW_ISO })
  // Exactly what Sommel's bridge accepts in patch: status and last_activity_at.
  assert.deepEqual(out.patch, { status: 'en_proceso', last_activity_at: NOW_ISO })
})

test('newCustomerReplies: solo lo que el bar escribió desde la última copia', () => {
  const prev = { responses: [{ author_role: 'bar', body: 'a' }, { author_role: 'acacia', body: 'b' }] }
  const next = { responses: [...prev.responses, { author_role: 'acacia', body: 'c' }, { author_role: 'bar', body: 'd' }] }
  assert.deepEqual(newCustomerReplies('sommel', prev, next).map((m) => m.body), ['d'])
  // The same record pinged twice alerts once.
  assert.deepEqual(newCustomerReplies('sommel', next, next), [])
  // First sight of a ticket with no copy yet: every bar message is new.
  assert.equal(newCustomerReplies('sommel', null, next).length, 2)
  // Apps that did not opt in never alert on replies.
  assert.deepEqual(newCustomerReplies('rumbo', { responses: [] }, { responses: [{ author_role: 'requester', body: 'x' }] }), [])
})
