// Cron: pull product-usage counts from each Base44 app (via the acaciaControl
// bridge → usage.summary) and store today's snapshot in usage_daily. Idempotent
// per day (delete + insert the app's portfolio-level rows for today).
import { supabaseAdmin, requireSupabase, audit } from '../_lib/supabaseAdmin.js'
import { callBridge, bridgeConfigured } from '../_lib/appBridge.js'

export default async function handler(req, res) {
  const secret = process.env.CRON_SECRET
  if (secret && req.headers.authorization !== `Bearer ${secret}` && !req.headers['x-vercel-cron']) {
    return res.status(401).json({ error: 'unauthorized' })
  }
  if (!requireSupabase(res)) return

  const { data: apps, error } = await supabaseAdmin.from('apps').select('*').eq('backend', 'base44')
  if (error) return res.status(500).json({ error: error.message })

  if (!bridgeConfigured()) {
    return res.status(200).json({ ok: true, note: 'INGEST_HMAC_SECRET not set', summary: apps.map((a) => ({ app: a.id, skipped: 'no secret' })) })
  }

  const day = new Date().toISOString().slice(0, 10)
  const summary = []

  for (const app of apps) {
    const entities = app.config?.usage_entities ?? []
    if (entities.length === 0) { summary.push({ app: app.id, skipped: 'no usage_entities' }); continue }
    try {
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
      summary.push({ app: app.id, metrics: rows.length })
    } catch (e) {
      summary.push({ app: app.id, error: e.message })
    }
  }

  await audit('sync-usage', { payload: { day, summary } })
  return res.status(200).json({ ok: true, day, summary })
}
