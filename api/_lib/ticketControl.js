// Per-app support-ticket model. ALL NINE portfolio apps persist tickets and are
// configured here. Two conversation shapes:
//   - eight apps (puntos, stockflow, flowfin, cateqhub, radar, liuma, ctrlhq,
//     kitchops): a SupportTicket header + a SEPARATE SupportTicketMessage thread
//     entity (author_role marks staff vs customer) — `thread.mode: 'message'`.
//   - rumbo: a SupportTicket whose conversation lives INLINE in a `responses[]`
//     array on the ticket itself, no message entity — `thread.mode: 'inline'`.
// Mission Control owns this mapping; the bridge (tickets.list / tickets.thread /
// tickets.update) stays generic.
//
// This header used to say only three apps persisted tickets, that stockflow's
// support was a fire-and-forget email and that flowfin had none. That stopped
// being true as the apps were brought up to Module 8, and the comment did not
// follow — worth naming, because a stale comment about WHO IS COVERED is the
// kind that gets trusted instead of the config right below it.
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
      nameField: 'author_name', tsField: 'created_date', rich: true,
    },
  },
  // StockFlow & FlowFin mirror the puntos model (SupportTicket + SupportTicketMessage,
  // owner/tenant roles, rich counters) — only the tenant FK differs.
  stockflow: {
    entity: 'SupportTicket', tenantField: 'business_id',
    subjectField: 'subject', statusField: 'status', priorityField: 'priority',
    requester: { nameField: 'created_by_email', emailField: 'created_by_email' },
    statuses: ['open', 'in_progress', 'waiting_customer', 'resolved', 'closed'],
    openStatus: 'open', inProgressStatus: 'in_progress',
    resolvedField: 'resolved_at', closedField: 'closed_at',
    thread: {
      mode: 'message', messageEntity: 'SupportTicketMessage', fkField: 'ticket_id',
      bodyField: 'body', roleField: 'author_role', staffRole: 'owner', customerRole: 'tenant',
      nameField: 'author_name', tsField: 'created_date', rich: true,
    },
  },
  flowfin: {
    entity: 'SupportTicket', tenantField: 'family_id',
    subjectField: 'subject', statusField: 'status', priorityField: 'priority',
    requester: { nameField: 'created_by_email', emailField: 'created_by_email' },
    statuses: ['open', 'in_progress', 'waiting_customer', 'resolved', 'closed'],
    openStatus: 'open', inProgressStatus: 'in_progress',
    resolvedField: 'resolved_at', closedField: 'closed_at',
    thread: {
      mode: 'message', messageEntity: 'SupportTicketMessage', fkField: 'ticket_id',
      bodyField: 'body', roleField: 'author_role', staffRole: 'owner', customerRole: 'tenant',
      nameField: 'author_name', tsField: 'created_date', rich: true,
    },
  },
  // CateqHub (parish QR attendance) mirrors the puntos rich model; tenant FK is parish_id.
  cateqhub: {
    entity: 'SupportTicket', tenantField: 'parish_id',
    subjectField: 'subject', statusField: 'status', priorityField: 'priority',
    requester: { nameField: 'created_by_email', emailField: 'created_by_email' },
    statuses: ['open', 'in_progress', 'waiting_customer', 'resolved', 'closed'],
    openStatus: 'open', inProgressStatus: 'in_progress',
    resolvedField: 'resolved_at', closedField: 'closed_at',
    thread: {
      mode: 'message', messageEntity: 'SupportTicketMessage', fkField: 'ticket_id',
      bodyField: 'body', roleField: 'author_role', staffRole: 'owner', customerRole: 'tenant',
      nameField: 'author_name', tsField: 'created_date', rich: true,
    },
  },
  // Radar (HR/attendance) mirrors the puntos rich model; tenant FK is company_id.
  radar: {
    entity: 'SupportTicket', tenantField: 'company_id',
    subjectField: 'subject', statusField: 'status', priorityField: 'priority',
    requester: { nameField: 'created_by_email', emailField: 'created_by_email' },
    statuses: ['open', 'in_progress', 'waiting_customer', 'resolved', 'closed'],
    openStatus: 'open', inProgressStatus: 'in_progress',
    resolvedField: 'resolved_at', closedField: 'closed_at',
    thread: {
      mode: 'message', messageEntity: 'SupportTicketMessage', fkField: 'ticket_id',
      bodyField: 'body', roleField: 'author_role', staffRole: 'owner', customerRole: 'tenant',
      nameField: 'author_name', tsField: 'created_date', rich: true,
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
  // CtrlHQ: simpler 2-state model (submitted/resolved, no in_progress/closed
  // stage and no resolved_at/closed_at timestamps yet) — resolvedField/
  // closedField are null, which the bridge treats as "don't stamp a date."
  ctrlhq: {
    entity: 'SupportTicket', tenantField: 'business_id',
    subjectField: 'subject', statusField: 'status', priorityField: null,
    requester: { nameField: 'created_by_email', emailField: 'created_by_email' },
    statuses: ['submitted', 'resolved'],
    openStatus: 'submitted', inProgressStatus: 'submitted',
    resolvedField: null, closedField: null,
    thread: {
      mode: 'message', messageEntity: 'SupportTicketMessage', fkField: 'ticket_id',
      bodyField: 'body', roleField: 'author_role', staffRole: 'acacia_staff', customerRole: 'tenant',
      nameField: 'author_name', tsField: 'created_date', rich: false,
    },
  },
  // KitchOps: four-state model with a real resolved_at, and a `category`
  // ('soporte' | 'mejora' | 'facturacion' | 'cuenta') the tenant picks — this
  // bridge does not read it, but it is why KitchOps has no separate
  // "solicitud de mejora" entity to bridge in addition to this one.
  kitchops: {
    entity: 'SupportTicket', tenantField: 'business_id',
    subjectField: 'subject', statusField: 'status', priorityField: 'priority',
    requester: { nameField: 'created_by_email', emailField: 'created_by_email' },
    statuses: ['submitted', 'in_progress', 'waiting_customer', 'resolved'],
    openStatus: 'submitted', inProgressStatus: 'in_progress',
    resolvedField: 'resolved_at', closedField: null,
    thread: {
      mode: 'message', messageEntity: 'SupportTicketMessage', fkField: 'ticket_id',
      bodyField: 'body', roleField: 'author_role', staffRole: 'owner', customerRole: 'tenant',
      nameField: 'author_name', tsField: 'created_date', rich: false,
    },
  },
  // ArtisKids: registered 2026-09-22. SupportTicket carries a single
  // `message` field, no separate SupportTicketMessage entity and no inline
  // responses[] array — its CLAUDE.md is explicit that a two-way reply
  // thread isn't built yet ("Mission Control's own panel is where a human
  // replies" means by email, not by writing back into this entity). Module
  // 8's letter only requires the entry point + real-time sync, which this
  // satisfies. `thread: null` and buildTicketReply below guards on it and
  // errors instead of assuming a thread shape that doesn't exist here.
  artiskids: {
    entity: 'SupportTicket', tenantField: 'family_id',
    subjectField: 'subject', statusField: 'status', priorityField: null,
    requester: { nameField: 'created_by_email', emailField: 'created_by_email' },
    statuses: ['open', 'resolved', 'closed'],
    openStatus: 'open', inProgressStatus: 'open', // no in_progress in its enum; unused, see buildTicketReply's guard
    resolvedField: null, closedField: null,
    activityField: 'last_activity_at',
    thread: null,
  },
  // Sommel: registered 2026-09-30; conversation added the same day. Its
  // SupportTicket keeps the customer's first message in `body` and the rest of
  // the conversation INLINE in `responses[]` (like rumbo), with its own Spanish
  // statuses. `includeOriginal` puts `body` first in the thread the panel shows;
  // `notifyCustomerReplies` makes the ingest path alert support when the bar
  // answers on a ticket MC already knew about. Its bridge only accepts replies
  // with author_role 'acacia' and emails the bar when one lands.
  sommel: {
    entity: 'SupportTicket', tenantField: 'tenant_id',
    subjectField: 'subject', statusField: 'status', priorityField: null,
    requester: { nameField: 'created_by_email', emailField: 'created_by_email' },
    statuses: ['abierto', 'en_proceso', 'cerrado'],
    openStatus: 'abierto', inProgressStatus: 'en_proceso',
    resolvedField: null, closedField: null,
    activityField: 'last_activity_at',
    thread: {
      mode: 'inline', arrayField: 'responses',
      bodyField: 'body', roleField: 'author_role', staffRole: 'acacia', customerRole: 'bar',
      nameField: 'author_name', tsField: 'created_at',
      includeOriginal: true, notifyCustomerReplies: true,
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

// For an app with `thread: null` (artiskids, sommel) the conversation is just
// the customer's original message on the ticket itself. Returned in the same
// normalized shape as normalizeMessage so the panel renders it like any thread.
export function originalMessageThread(raw) {
  const r = raw ?? {}
  const body = r.body ?? r.message ?? r.description ?? null
  if (!body) return []
  return [{ staff: false, name: r.created_by_email ?? null, body: String(body), ts: r.created_date ?? r.created_at ?? null }]
}

// Customer messages on `nextRaw` that were not on `prevRaw` — for apps whose
// thread sets notifyCustomerReplies. Counted, not diffed by content, so the
// same record pinged twice yields nothing the second time.
export function newCustomerReplies(appId, prevRaw, nextRaw) {
  const t = APPS[appId]?.thread
  if (!t || t.mode !== 'inline' || !t.notifyCustomerReplies) return []
  const mine = (raw) => (Array.isArray(raw?.[t.arrayField]) ? raw[t.arrayField] : [])
    .filter((m) => m && m[t.roleField] === t.customerRole)
  const before = mine(prevRaw).length
  return mine(nextRaw).slice(before)
}

// What an incoming ping should alert about. `existing` is the bodega row (null
// when MC has never seen the ticket), `replyCount` what newCustomerReplies found
// against its stored raw. Replies are checked whenever a row exists, NOT only
// once notified: a ticket the daily sync imported has notified_at null, and its
// first customer reply must still be quoted as a reply. notified_at only guards
// the one-time new-ticket alert.
//   'reply' → alert the new customer messages (and mark the ticket notified)
//   'new'   → the one-time new-ticket alert
//   'none'  → reflect-only (a retry or a status echo)
export function ingestAlertKind(existing, replyCount) {
  if (existing && replyCount > 0) return 'reply'
  if (existing?.notified_at) return 'none'
  return 'new'
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
  if (!cfg.thread) return { error: `${appId} no soporta respuestas desde el panel todavía` }
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
    if (t.rich) {
      // puntos / stockflow / flowfin: full thread metadata + unread/counter fields.
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
