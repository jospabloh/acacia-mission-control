// ITSM auto-close: a ticket left in "resolved" with no activity for N days is
// moved to "closed". The clock is the ticket's last activity (staff reply, status
// change, OR a customer message) — so if the customer writes back about the
// ticket, last_activity_at bumps and the ticket is NOT auto-closed. Runs in the
// daily cron (api/cron/sync.js) via the same acaciaControl bridge that powers the
// Support inbox, so the app's backend stays the source of truth. App-agnostic:
// applies to every app whose ticket model has both a resolved and a closed status.
import { supabaseAdmin, audit } from '../supabaseAdmin.js'
import { callBridge } from '../appBridge.js'
import { ticketControlFor, buildTicketStatus } from '../ticketControl.js'

// Grace window before a resolved ticket auto-closes. Configurable; default 2 days.
const AUTOCLOSE_DAYS = Number(process.env.TICKET_AUTOCLOSE_DAYS || 2)

const firstMatching = (statuses, re) => (statuses ?? []).find((s) => re.test(s)) ?? null
// Effective "last touched" time for staleness: real activity, else creation.
const activityTime = (r) => r.last_activity_at || r.customer_created_at || r.created_at || null

// The app's resolved/closed status names, derived from its ticket model. Null when
// the model lacks either (that app is then skipped). Pure — exported for tests.
export function resolveAutocloseStatuses(cfg) {
  return {
    resolvedStatus: firstMatching(cfg?.statuses, /resolved/i),
    closedStatus: firstMatching(cfg?.statuses, /closed/i),
  }
}

// Is this (already-resolved) ticket idle past the grace window? A newer activity
// time (e.g. a customer message) keeps it open. Pure — exported for tests.
export function isStaleResolved(row, { now = new Date(), days = AUTOCLOSE_DAYS } = {}) {
  const t = activityTime(row)
  const ms = t ? Date.parse(t) : NaN
  return !Number.isNaN(ms) && ms <= now.getTime() - days * 86_400_000
}

// Close every ticket of `app` that has sat in its resolved status past the grace
// window with no newer activity. `now` is injectable for tests. Returns a summary.
export async function autoCloseResolvedForApp(app, { now = new Date(), days = AUTOCLOSE_DAYS } = {}) {
  const cfg = ticketControlFor(app.id)
  if (!cfg) return { app: app.id, skipped: 'app sin tickets' }
  const { resolvedStatus, closedStatus } = resolveAutocloseStatuses(cfg)
  if (!resolvedStatus || !closedStatus) return { app: app.id, skipped: 'sin estado resolved/closed' }

  // Candidates: this app's tickets currently in the resolved status (case-insensitive
  // so 'resolved'/'RESOLVED' both match). We read the raw record buildTicketStatus needs.
  const { data: rows, error } = await supabaseAdmin
    .from('tickets')
    .select('id, external_id, status, last_activity_at, customer_created_at, created_at, raw')
    .eq('app_id', app.id)
    .ilike('status', resolvedStatus)
  if (error) return { app: app.id, error: error.message }

  const stale = (rows ?? []).filter((r) => isStaleResolved(r, { now, days }))
  if (!stale.length) return { app: app.id, closed: 0, scanned: rows?.length ?? 0 }

  const closed = []
  const failed = []
  for (const r of stale) {
    const raw = r.raw ?? {}
    // buildTicketStatus keys the app write off the raw record's real id.
    const params = buildTicketStatus(app.id, { ticketRaw: raw, status: closedStatus, now })
    if (params.error) { failed.push({ id: r.external_id, error: params.error }); continue }
    try {
      await callBridge(app, 'tickets.update', params)
      // Reflect immediately in the bodega so the inbox updates before the next sync.
      await supabaseAdmin.from('tickets').update({ status: closedStatus }).eq('id', r.id)
      closed.push(r.external_id)
    } catch (e) {
      failed.push({ id: r.external_id, error: e.message })
    }
  }

  if (closed.length || failed.length) {
    await audit('ticket:autoclose', {
      target_app: app.id, target_type: 'ticket',
      payload: { days, closed: closed.length, failed: failed.length, ids: closed },
    })
  }
  return { app: app.id, closed: closed.length, failed: failed.length, scanned: rows?.length ?? 0 }
}
