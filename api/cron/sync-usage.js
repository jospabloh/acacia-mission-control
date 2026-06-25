// Cron: pull product-usage counts from each Base44 app (via the acaciaControl
// bridge → usage.summary) and store today's snapshot in usage_daily. Idempotent
// per day. Per-app logic lives in _lib/sync/syncUsage.js (shared with control).
import { supabaseAdmin, requireSupabase, audit } from '../_lib/supabaseAdmin.js'
import { bridgeConfigured } from '../_lib/appBridge.js'
import { syncUsageForApp } from '../_lib/sync/syncUsage.js'

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
    try { summary.push(await syncUsageForApp(app, day)) }
    catch (e) { summary.push({ app: app.id, error: e.message }) }
  }

  await audit('sync-usage', { payload: { day, summary } })
  return res.status(200).json({ ok: true, day, summary })
}
