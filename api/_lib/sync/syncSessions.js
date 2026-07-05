// Per-app session sync: read an app's AppSession entity through its HMAC-signed
// acaciaControl bridge (`sessions.list`) and upsert normalized rows into the
// bodega `app_sessions` table. Idempotent (upsert on natural keys). Then prune
// sessions idle past the open window — they're considered ended. Shared by the
// daily cron and the on-demand control endpoint so both behave identically.
import { supabaseAdmin } from '../supabaseAdmin.js'
import { callBridge } from '../appBridge.js'
import { OPEN_WINDOW_MS } from '../sessions.js'

export async function syncSessionsForApp(app) {
  const entity = app.config?.session_entity
  if (!entity) return { app: app.id, skipped: 'no session_entity in config' }

  let result
  try {
    result = await callBridge(app, 'sessions.list', { entity })
  } catch (e) {
    return { app: app.id, skipped: `bridge unreachable: ${e.message}` }
  }
  const records = result?.records ?? result?.data?.records ?? []
  if (!Array.isArray(records)) return { app: app.id, error: 'bridge returned no records array' }

  const now = new Date()
  const nowIso = now.toISOString()
  const cutoffIso = new Date(now.getTime() - OPEN_WINDOW_MS).toISOString()

  // Keep only sessions that heartbeated within the open window; older ones are
  // treated as ended and never written (and pruned below).
  const rows = records
    .filter((r) => r && r.id && r.last_active_at && r.last_active_at >= cutoffIso)
    .map((r) => ({
      app_id: app.id,
      external_id: String(r.id),
      user_email: r.user_email ?? null,
      user_name: r.user_name ?? null,
      device: r.device ?? null,
      started_at: r.started_at ?? null,
      last_active_at: r.last_active_at ?? null,
      revoked_at: r.revoked_at ?? null,
      raw: r,
      synced_at: nowIso,
    }))

  if (rows.length) {
    const { error: uErr } = await supabaseAdmin
      .from('app_sessions').upsert(rows, { onConflict: 'app_id,external_id' })
    if (uErr) throw new Error(`app_sessions upsert: ${uErr.message}`)
  }

  // Prune this app's rows that have fallen outside the open window (ended
  // sessions, or ones the app deleted), so the bodega count stays truthful.
  const { error: dErr } = await supabaseAdmin
    .from('app_sessions').delete().eq('app_id', app.id).lt('last_active_at', cutoffIso)
  if (dErr) throw new Error(`app_sessions prune: ${dErr.message}`)

  return { app: app.id, records: records.length, upserted: rows.length }
}
