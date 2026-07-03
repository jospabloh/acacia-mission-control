// Auto-close support tickets that have sat in "resolved" for longer than the
// window (default 2 days) with no further activity from the requester. When a
// ticket is resolved the customer can still reopen it by replying; their reply
// bumps the app's activity clock (and, in the message-thread apps, flips
// last_message_by_role back to the customer). So a ticket that is STILL
// "resolved" and whose resolution has aged past the window means the customer
// never came back — we close it.
//
// Mission Control owns this sweep (one place, all apps) instead of a per-app
// Base44 cron: FlowFin and StockFlow sit at Base44's 50-function cap and can't
// take a new scheduled function, and the closure has to reach every app's
// backend anyway. The write goes back to each app through the same
// acaciaControl `tickets.update` bridge the support console uses, so the app
// backend stays the source of truth; the bodega copy is updated to match.
//
// Runs from the daily cron AFTER tickets re-sync, so `status`, `resolved_at`
// (in `raw`) and `last_activity_at` reflect each app's source of truth.
//
// The Supabase and Base44-bridge clients are imported lazily inside the async
// orchestrator so the pure decision logic below stays importable (and unit
// testable) without those runtime deps installed.
import { ticketControlFor, buildTicketStatus } from './ticketControl.js'

// Default grace period, in days, a ticket may sit "resolved" before we close it.
// Overridable with the TICKET_AUTOCLOSE_DAYS env var (integer > 0).
export const DEFAULT_AUTOCLOSE_DAYS = 2

export function autoCloseDays() {
  const raw = parseInt(process.env.TICKET_AUTOCLOSE_DAYS ?? '', 10)
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_AUTOCLOSE_DAYS
}

// The app's terminal status labels. Apps use lowercase ('resolved'/'closed');
// liuma uses uppercase ('RESOLVED'/'CLOSED'). Match case-insensitively.
export function resolvedStatusFor(cfg) {
  return cfg?.statuses?.find((s) => String(s).toLowerCase() === 'resolved') ?? null
}
export function closedStatusFor(cfg) {
  return cfg?.statuses?.find((s) => String(s).toLowerCase() === 'closed') ?? null
}

// Pure decision: should this synced ticket row be auto-closed now? Kept free of
// I/O so it is unit-testable across the two ticket variants.
//   cfg  — the app's ticketControl config
//   row  — a bodega `tickets` row: { status, last_activity_at, raw }
//   cutoffMs — Date.parse cutoff; resolution older than this closes the ticket
export function autoCloseDecision(cfg, row, { cutoffMs } = {}) {
  const resolved = resolvedStatusFor(cfg)
  const closed = closedStatusFor(cfg)
  if (!resolved || !closed) return { close: false, reason: 'app sin estados resolved/closed' }

  const raw = row?.raw ?? {}
  if (row?.status !== resolved) return { close: false, reason: 'no está en resolved' }

  // The requester had the last word (reopened the conversation) → leave it for a
  // human, don't auto-close. Only the message-thread apps track this.
  const customerRole = cfg.thread?.mode === 'message' ? cfg.thread.customerRole : null
  if (customerRole && raw.last_message_by_role === customerRole) {
    return { close: false, reason: 'el solicitante respondió' }
  }

  // Anchor = when the ticket entered "resolved". Message-thread apps stamp
  // `resolved_at`; rumbo (inline) has only `last_activity_at`, which it sets when
  // the status moves to resolved.
  const anchorISO = (cfg.resolvedField && raw[cfg.resolvedField]) || row?.last_activity_at || null
  const anchorMs = anchorISO ? Date.parse(anchorISO) : NaN
  if (!Number.isFinite(anchorMs)) return { close: false, reason: 'sin fecha de resolución' }
  if (anchorMs > cutoffMs) return { close: false, reason: 'dentro de la ventana' }

  return { close: true, reason: 'resuelto sin actividad > ventana', status: closed }
}

// Sweep one app: find resolved tickets in the bodega, close the aged ones on the
// app backend (bridge) and mirror the change into the bodega. Idempotent — a
// ticket already closed no longer matches the resolved filter.
export async function sweepAutoCloseForApp(app, { days = autoCloseDays(), now = new Date() } = {}) {
  const cfg = ticketControlFor(app.id)
  if (!cfg) return { app: app.id, skipped: 'app sin tickets' }
  const resolved = resolvedStatusFor(cfg)
  const closed = closedStatusFor(cfg)
  if (!resolved || !closed) return { app: app.id, skipped: 'sin estados resolved/closed' }

  const { supabaseAdmin } = await import('./supabaseAdmin.js')
  const { callBridge, bridgeConfigured } = await import('./appBridge.js')
  if (!bridgeConfigured()) return { app: app.id, skipped: 'bridge no configurado' }

  const cutoffMs = now.getTime() - days * 24 * 60 * 60 * 1000

  // Support volume is low; pull the app's resolved tickets and decide in JS
  // (anchor may be `raw.resolved_at`, not the indexed `last_activity_at` column).
  const { data: rows, error } = await supabaseAdmin
    .from('tickets')
    .select('external_id, status, last_activity_at, raw')
    .eq('app_id', app.id)
    .eq('status', resolved)
  if (error) return { app: app.id, error: error.message }
  if (!rows?.length) return { app: app.id, closed: 0 }

  const nowISO = now.toISOString()
  let n = 0
  const errors = []
  for (const row of rows) {
    const decision = autoCloseDecision(cfg, row, { cutoffMs })
    if (!decision.close) continue
    const change = buildTicketStatus(app.id, { ticketRaw: row.raw, status: decision.status, now })
    if (change.error) { errors.push(`${row.external_id}: ${change.error}`); continue }
    try {
      await callBridge(app, 'tickets.update', change)
      await supabaseAdmin
        .from('tickets')
        .update({ status: decision.status, last_activity_at: nowISO })
        .eq('app_id', app.id)
        .eq('external_id', row.external_id)
      n++
    } catch (e) {
      errors.push(`${row.external_id}: ${e.message}`)
    }
  }
  return { app: app.id, closed: n, ...(errors.length ? { errors } : {}) }
}
