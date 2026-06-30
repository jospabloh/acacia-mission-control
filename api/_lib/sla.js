// ITIL-style SLA policy for support tickets. One place owns the response/
// resolution targets per priority; both the real-time push ingest
// (api/ingest/ticket.js) and the daily sync (sync/ticketMapping.js) compute the
// same due timestamps from it, so the clock is identical no matter how a ticket
// reached the bodega.
//
// The SLA clock starts when the CUSTOMER creates the ticket (the app's own
// created_date), NOT when Mission Control finds out. That is the whole point of
// the push path: MC learns about the ticket within seconds, but even if a push
// is delayed the due times are anchored to the customer's creation instant.

// Targets in minutes from ticket creation. response = time to first staff reply
// (first_response_at); resolve = time to a resolved/closed status.
export const SLA_TARGETS = {
  urgent: { responseMin: 60, resolveMin: 240 }, //  1h /  4h
  high: { responseMin: 240, resolveMin: 480 }, //  4h /  8h
  normal: { responseMin: 480, resolveMin: 1440 }, //  8h / 24h
  low: { responseMin: 1440, resolveMin: 4320 }, // 24h / 72h
}
const DEFAULT_PRIORITY = 'normal'

// Apps use different priority vocabularies; collapse to the four ITIL tiers.
export function normalizePriority(priority) {
  const p = String(priority ?? '').trim().toLowerCase()
  if (SLA_TARGETS[p]) return p
  if (['critical', 'p1', 'highest', 'emergency'].includes(p)) return 'urgent'
  if (['p2', 'elevated'].includes(p)) return 'high'
  if (['p4', 'minor', 'lowest'].includes(p)) return 'low'
  if (['medium', 'p3', 'standard', ''].includes(p)) return 'normal'
  return DEFAULT_PRIORITY
}

const MIN = 60_000

// Given the customer-creation instant (ISO/Date) and a priority, return the SLA
// envelope: normalized priority + due timestamps (ISO) for first response and
// resolution. Returns nulls when the creation time can't be parsed.
export function computeSla(createdAt, priority) {
  const tier = normalizePriority(priority)
  const t = createdAt ? Date.parse(createdAt) : NaN
  if (Number.isNaN(t)) {
    return { priority: tier, firstResponseDueAt: null, resolveDueAt: null }
  }
  const { responseMin, resolveMin } = SLA_TARGETS[tier]
  return {
    priority: tier,
    firstResponseDueAt: new Date(t + responseMin * MIN).toISOString(),
    resolveDueAt: new Date(t + resolveMin * MIN).toISOString(),
  }
}

// Whether `dueAt` is already past `now` and the ticket hasn't met that milestone
// yet (`metAt` null/empty). Used by the UI to flag a breach.
export function isBreached(dueAt, metAt, now = Date.now()) {
  if (metAt) return false
  if (!dueAt) return false
  const d = Date.parse(dueAt)
  return !Number.isNaN(d) && d < now
}
