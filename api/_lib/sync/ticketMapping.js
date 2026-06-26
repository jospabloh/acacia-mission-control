// Pure mapping from a raw SupportTicket record → a bodega `tickets` row.
// Mission Control owns the per-app field names (api/_lib/ticketControl.js); this
// turns one raw record into the normalized columns. The full record is kept in
// `raw` so reply/status builders can read counters, the inline thread, etc.
import { ticketControlFor } from '../ticketControl.js'

function isoOrNull(v) {
  if (!v) return null
  const t = Date.parse(v)
  return Number.isNaN(t) ? null : new Date(t).toISOString()
}

export function isTicketMappable(record) {
  return record && record.id !== undefined && record.id !== null && String(record.id) !== ''
}

// → { ticket, tenantExternalId }. tenant_id (bodega FK) is resolved by the caller.
export function mapTicketRecord(record, app) {
  const cfg = ticketControlFor(app.id)
  const tenantExternalId = cfg?.tenantField ? (record[cfg.tenantField] ?? null) : null
  const requester = {}
  if (cfg?.requester?.nameField) requester.name = record[cfg.requester.nameField] ?? null
  if (cfg?.requester?.emailField) requester.email = record[cfg.requester.emailField] ?? null

  const ticket = {
    app_id: app.id,
    external_id: String(record.id),
    subject: (cfg?.subjectField ? record[cfg.subjectField] : record.subject) ?? null,
    status: (cfg?.statusField ? record[cfg.statusField] : record.status) ?? null,
    priority: (cfg?.priorityField ? record[cfg.priorityField] : record.priority) ?? null,
    requester,
    raw: record ?? {},
    // The app's real last-activity time, for inbox recency sort. (updated_at is
    // overwritten by the touch trigger on every resync, so it can't serve this.)
    last_activity_at: isoOrNull(record.last_activity_at || record.last_message_at || record.updated_date),
  }
  return { ticket, tenantExternalId: tenantExternalId != null ? String(tenantExternalId) : null }
}
