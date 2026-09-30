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
  sommel: { name: 'Sommel', statuses: ['abierto', 'en_proceso', 'cerrado'], closeStatus: 'cerrado', canReply: false },
  rumbo: { name: 'Rumbo', statuses: ['open', 'in_progress', 'resolved', 'closed'], closeStatus: 'closed', canReply: true },
}

export const TICKET_APPS = Object.entries(TICKET_CATALOG).map(([id, c]) => ({ id, name: c.name }))

// A ticket is open unless its status is terminal. Defined by what is DONE, not
// by listing what is open, so a new app's opening state (ctrlhq's `submitted`)
// counts as open without anyone having to add it here.
const TERMINAL = new Set(['resolved', 'closed', 'cerrado', 'ai_resolved'])

export function isOpenTicket(status) {
  if (status == null || status === '') return true
  return !TERMINAL.has(String(status).toLowerCase())
}

export function isTerminalStatus(status) {
  return !isOpenTicket(status)
}
