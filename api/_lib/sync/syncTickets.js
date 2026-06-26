// Per-app ticket sync: read an app's SupportTicket records through its HMAC-signed
// acaciaControl bridge (tickets.list) and upsert normalized ticket headers into
// the bodega. Idempotent (upsert on app_id+external_id). Only the 3 apps that
// persist tickets (puntos/rumbo/liuma) are syncable; others are skipped. The
// message thread is loaded on demand (ticket-thread endpoint), not synced here.
import { supabaseAdmin } from '../supabaseAdmin.js'
import { callBridge } from '../appBridge.js'
import { ticketControlFor } from '../ticketControl.js'
import { mapTicketRecord, isTicketMappable } from './ticketMapping.js'

export async function syncTicketsForApp(app) {
  const cfg = ticketControlFor(app.id)
  if (!cfg) return { app: app.id, skipped: 'app sin tickets' }

  let result
  try {
    result = await callBridge(app, 'tickets.list', { entity: cfg.entity })
  } catch (e) {
    return { app: app.id, skipped: `bridge unreachable: ${e.message}` }
  }
  const records = result?.records ?? result?.data?.records ?? []
  if (!Array.isArray(records)) return { app: app.id, error: 'bridge returned no records array' }

  const mapped = records.filter(isTicketMappable).map((r) => mapTicketRecord(r, app))

  // Resolve tenant_id (bodega FK) from already-synced tenants where possible.
  const extIds = [...new Set(mapped.map((m) => m.tenantExternalId).filter(Boolean))]
  let idByExt = {}
  if (extIds.length) {
    const { data: tRows } = await supabaseAdmin
      .from('tenants').select('id, external_id').eq('app_id', app.id).in('external_id', extIds)
    idByExt = Object.fromEntries((tRows ?? []).map((t) => [t.external_id, t.id]))
  }

  const rows = mapped.map((m) => ({
    ...m.ticket,
    tenant_id: m.tenantExternalId ? (idByExt[m.tenantExternalId] ?? null) : null,
  }))
  if (rows.length) {
    const { error } = await supabaseAdmin.from('tickets').upsert(rows, { onConflict: 'app_id,external_id' })
    if (error) throw new Error(`tickets upsert: ${error.message}`)
  }
  return { app: app.id, tickets: rows.length }
}
