// Per-app support-ticket model. Only three portfolio apps persist tickets:
//   - puntos & liuma: a SupportTicket header + a SEPARATE SupportTicketMessage
//     thread entity (author_role marks staff vs customer).
//   - rumbo: a SupportTicket whose conversation lives INLINE in a `responses[]`
//     array on the ticket itself (no message entity).
// stockflow's "support" is a fire-and-forget email (no entity) and flowfin has
// none — so neither appears here. Mission Control owns this mapping; the bridge
// (tickets.list / tickets.thread / tickets.update) stays generic.
//
// Fields verified against each app's source (SupportTicket / SupportTicketMessage
// entities + their support UIs), 2026-06.

const APPS = {
  puntos: {
    entity: 'SupportTicket', tenantField: 'business_id',
    subjectField: 'subject', statusField: 'status', priorityField: 'priority',
    requester: { nameField: 'created_by_email', emailField: 'created_by_email' },
    statuses: ['open', 'in_progress', 'waiting_customer', 'resolved', 'closed'],
    openStatus: 'open', inProgressStatus: 'in_progress',
    resolvedField: 'resolved_at', closedField: 'closed_at',
    thread: {
      mode: 'message', messageEntity: 'SupportTicketMessage', fkField: 'ticket_id',
      bodyField: 'body', roleField: 'author_role', staffRole: 'owner', customerRole: 'tenant',
      nameField: 'author_name', tsField: 'created_date',
    },
  },
  liuma: {
    entity: 'SupportTicket', tenantField: 'school_id',
    subjectField: 'subject', statusField: 'status', priorityField: 'priority',
    requester: { nameField: 'requester_name', emailField: null },
    statuses: ['OPEN', 'IN_PROGRESS', 'WAITING_USER', 'ESCALATED', 'RESOLVED', 'CLOSED'],
    openStatus: 'OPEN', inProgressStatus: 'IN_PROGRESS',
    resolvedField: 'resolved_at', closedField: null, // CLOSED is a status; no closed_at field
    thread: {
      mode: 'message', messageEntity: 'SupportTicketMessage', fkField: 'ticket_id',
      bodyField: 'body', roleField: 'author_role', staffRole: 'OWNER', customerRole: 'REQUESTER',
      nameField: null, tsField: 'created_date',
    },
  },
  rumbo: {
    entity: 'SupportTicket', tenantField: 'tenant_id',
    subjectField: 'subject', statusField: 'status', priorityField: 'priority',
    requester: { nameField: 'requester_name', emailField: 'requester_email' },
    statuses: ['open', 'in_progress', 'resolved', 'closed'],
    openStatus: 'open', inProgressStatus: 'in_progress',
    resolvedField: null, closedField: null, // rumbo tracks only status + last_activity_at
    activityField: 'last_activity_at',
    thread: {
      mode: 'inline', arrayField: 'responses',
      bodyField: 'body', roleField: 'author_role', staffRole: 'support', customerRole: 'requester',
      nameField: 'author_name', tsField: 'created_at',
    },
  },
}

export function ticketControlFor(appId) {
  return APPS[appId] ?? null
}

export function ticketApps() {
  return Object.keys(APPS)
}

export function ticketStatusesFor(appId) {
  return APPS[appId]?.statuses ?? []
}

const STAFF_NAME = 'ACACIA Soporte'

// Build the bridge `tickets.update` params for a staff REPLY. `ticketRaw` is the
// synced raw ticket (from the bodega) so we can compute counters/first-response.
export function buildTicketReply(appId, { ticketRaw, body, actorEmail, actorName, now = new Date() } = {}) {
  const cfg = APPS[appId]
  if (!cfg) return { error: `app ${appId} no soporta tickets` }
  const text = String(body ?? '').trim()
  if (!text) return { error: 'el mensaje no puede estar vacío' }
  const raw = ticketRaw ?? {}
  const id = raw.id
  if (!id) return { error: 'ticket sin id' }
  const nowISO = now.toISOString()
  const t = cfg.thread
  const out = { entity: cfg.entity, id }
  const patch = {}
  // Status: an open ticket moves to in_progress on first staff reply.
  const curStatus = raw[cfg.statusField]
  patch[cfg.statusField] = curStatus === cfg.openStatus ? cfg.inProgressStatus : curStatus

  if (t.mode === 'message') {
    const message = { [t.fkField]: id, [t.roleField]: t.staffRole, [t.bodyField]: text }
    // Denormalized tenant scope the message entities require.
    message[cfg.tenantField] = raw[cfg.tenantField]
    if (appId === 'puntos') {
      message.author_email = actorEmail || null
      message.author_name = actorName || STAFF_NAME
      message.is_internal_note = false
      patch.last_message_at = nowISO
      patch.last_message_by_role = t.staffRole
      patch.messages_count = (Number(raw.messages_count) || 0) + 1
      patch.unread_for_owner = false
      patch.unread_for_tenant = true
      patch.first_response_at = raw.first_response_at || nowISO
    } else if (appId === 'liuma') {
      // LIUMA messages denormalize requester_user_id for RLS.
      if (raw.requester_user_id) message.requester_user_id = raw.requester_user_id
      patch.first_response_at = raw.first_response_at || nowISO
    }
    out.messageEntity = t.messageEntity
    out.message = message
  } else { // inline (rumbo)
    out.appendField = t.arrayField
    out.appendItem = { author_name: actorName || STAFF_NAME, [t.roleField]: t.staffRole, [t.bodyField]: text, [t.tsField]: nowISO }
    out.currentArray = Array.isArray(raw[t.arrayField]) ? raw[t.arrayField] : []
    if (cfg.activityField) patch[cfg.activityField] = nowISO
  }
  out.patch = patch
  return out
}

// Build the bridge `tickets.update` params for a STATUS change.
export function buildTicketStatus(appId, { ticketRaw, status, now = new Date() } = {}) {
  const cfg = APPS[appId]
  if (!cfg) return { error: `app ${appId} no soporta tickets` }
  if (!cfg.statuses.includes(status)) return { error: `estado inválido para ${appId}: ${status}` }
  const raw = ticketRaw ?? {}
  const id = raw.id
  if (!id) return { error: 'ticket sin id' }
  const nowISO = now.toISOString()
  const patch = { [cfg.statusField]: status }
  // Stamp resolution/closure timestamps where the app models them.
  if (cfg.resolvedField && status === 'RESOLVED') patch[cfg.resolvedField] = nowISO
  if (cfg.resolvedField && status === 'resolved') patch[cfg.resolvedField] = nowISO
  if (cfg.closedField && (status === 'closed' || status === 'CLOSED')) patch[cfg.closedField] = nowISO
  if (cfg.activityField) patch[cfg.activityField] = nowISO
  return { entity: cfg.entity, id, patch }
}

// Normalize one raw thread message (or inline response) to a uniform UI shape.
export function normalizeMessage(appId, m) {
  const cfg = APPS[appId]
  const t = cfg?.thread
  if (!t || !m) return null
  const role = m[t.roleField]
  return {
    body: m[t.bodyField] ?? '',
    role,
    staff: role === t.staffRole,
    name: (t.nameField ? m[t.nameField] : null) || null,
    ts: m[t.tsField] || m.created_date || null,
  }
}
