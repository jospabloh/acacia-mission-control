// Client copy of the per-app ticket model in api/_lib/ticketControl.js (the
// client cannot import api/_lib). src/lib/ticketCatalog.test.js fails if the two
// drift: the Support page used to keep its own list of 5 apps, so tickets from
// the other 6 could be seen but never closed.
//
//   statuses    — what the status menu offers, in the app's own vocabulary.
//   closeStatus — what "Cerrar ticket" writes.
//   canReply    — false for apps without a thread (the reply box is hidden).
export const TICKET_CATALOG = {
  puntos: { name: 'Puntos+', statuses: ['open', 'in_progress', 'waiting_customer', 'resolved', 'closed'], closeStatus: 'closed', canReply: true },
  stockflow: { name: 'StockFlow', statuses: ['open', 'in_progress', 'waiting_customer', 'resolved', 'closed'], closeStatus: 'closed', canReply: true },
  flowfin: { name: 'FlowFin', statuses: ['open', 'in_progress', 'waiting_customer', 'resolved', 'closed'], closeStatus: 'closed', canReply: true },
  cateqhub: { name: 'CateqHub', statuses: ['open', 'in_progress', 'waiting_customer', 'resolved', 'closed'], closeStatus: 'closed', canReply: true },
  radar: { name: 'Radar', statuses: ['open', 'in_progress', 'waiting_customer', 'resolved', 'closed'], closeStatus: 'closed', canReply: true },
  liuma: { name: 'LIUMA', statuses: ['OPEN', 'IN_PROGRESS', 'WAITING_USER', 'ESCALATED', 'RESOLVED', 'CLOSED'], closeStatus: 'CLOSED', canReply: true },
  ctrlhq: { name: 'CtrlHQ', statuses: ['submitted', 'resolved'], closeStatus: 'resolved', canReply: true },
  kitchops: { name: 'KitchOps', statuses: ['submitted', 'in_progress', 'waiting_customer', 'resolved'], closeStatus: 'resolved', canReply: true },
  artiskids: { name: 'ArtisKids', statuses: ['open', 'resolved', 'closed'], closeStatus: 'closed', canReply: false },
  sommel: { name: 'Sommel', statuses: ['abierto', 'en_proceso', 'cerrado'], closeStatus: 'cerrado', canReply: true },
  rumbo: { name: 'Rumbo', statuses: ['open', 'in_progress', 'resolved', 'closed'], closeStatus: 'closed', canReply: true },
}

export const TICKET_APPS = Object.entries(TICKET_CATALOG).map(([id, c]) => ({ id, name: c.name }))

// A ticket is open unless its status is terminal. Defined by what is DONE, not
// by listing what is open, so a new app's opening state (ctrlhq's `submitted`)
// counts as open without anyone having to add it here.
export const TERMINAL_STATUSES = ['resolved', 'closed', 'cerrado', 'ai_resolved']
const TERMINAL = new Set(TERMINAL_STATUSES)

export function isOpenTicket(status) {
  if (status == null || status === '') return true
  return !TERMINAL.has(String(status).toLowerCase())
}

export function isTerminalStatus(status) {
  return !isOpenTicket(status)
}

// PostgREST filter for "open": a NULL status is open too, and `not.in` alone
// would drop it (NULL NOT IN (...) is NULL). Applied in the query, BEFORE the
// row limit, so old open tickets are never cut off by newer closed history.
export const OPEN_TICKETS_FILTER = `status.is.null,status.not.in.(${TERMINAL_STATUSES.join(',')})`

function dueMs(row) {
  const t = Date.parse(row?.sla_resolve_due_at)
  return Number.isNaN(t) ? null : t
}

export function isOverdue(row, now = Date.now()) {
  const due = dueMs(row)
  return due !== null && due < now
}

// Most urgent first: overdue before on time; within each group, the earliest
// SLA deadline first (a ticket overdue for days outranks one overdue for
// minutes); tickets without a deadline last; creation time only breaks ties.
export function compareByUrgency(a, b, now = Date.now()) {
  const late = Number(isOverdue(b, now)) - Number(isOverdue(a, now))
  if (late) return late
  const da = dueMs(a), db = dueMs(b)
  if (da !== db) {
    if (da === null) return 1
    if (db === null) return -1
    return da - db
  }
  const ca = Date.parse(a.customer_created_at || a.created_at) || 0
  const cb = Date.parse(b.customer_created_at || b.created_at) || 0
  return ca - cb
}

// How much of the resolve SLA a ticket has used, for the heat bar. The clock
// runs from the customer's creation instant to sla_resolve_due_at (the same
// anchor api/_lib/sla.js uses). `used` is 0..1, capped at 1 once overdue.
// Null when there is no clock: closed ticket, or missing/unparseable times.
export function slaProgress(row, now = Date.now()) {
  if (!row || !isOpenTicket(row.status)) return null
  const start = Date.parse(row.customer_created_at || row.created_at)
  const due = dueMs(row)
  if (Number.isNaN(start) || due === null || due <= start) return null
  const used = Math.min(1, Math.max(0, (now - start) / (due - start)))
  return { used, overdue: now > due, remainingMs: due - now }
}

// "3h 20m" for a duration in ms (sign ignored).
export function fmtDuration(ms) {
  const mins = Math.round(Math.abs(ms) / 60000)
  const d = Math.floor(mins / 1440)
  const h = Math.floor((mins % 1440) / 60)
  if (d >= 1) return h ? `${d}d ${h}h` : `${d}d`
  return h >= 1 ? `${h}h ${mins % 60}m` : `${mins}m`
}
