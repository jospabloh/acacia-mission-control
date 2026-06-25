// Per-app product-usage sync: pull entity counts through the acaciaControl
// bridge (usage.summary) and store the day's portfolio-level snapshot in
// usage_daily. Idempotent per day (replace the app's tenant-null rows). Shared
// by the daily cron and the on-demand control endpoint.
import { supabaseAdmin } from '../supabaseAdmin.js'
import { callBridge } from '../appBridge.js'

export async function syncUsageForApp(app, day) {
  const entities = app.config?.usage_entities ?? []
  if (entities.length === 0) return { app: app.id, skipped: 'no usage_entities' }

  const out = await callBridge(app, 'usage.summary', { entities })
  const counts = out?.counts ?? out?.data?.counts ?? {}
  const rows = Object.entries(counts)
    .filter(([, v]) => v != null)
    .map(([metric, value]) => ({ app_id: app.id, tenant_id: null, day, metric, value: Number(value) || 0 }))

  // Idempotent for the day: replace this app's portfolio-level rows.
  await supabaseAdmin.from('usage_daily').delete().eq('app_id', app.id).eq('day', day).is('tenant_id', null)
  if (rows.length) {
    const { error: uErr } = await supabaseAdmin.from('usage_daily').insert(rows)
    if (uErr) throw new Error(uErr.message)
  }
  return { app: app.id, metrics: rows.length }
}
