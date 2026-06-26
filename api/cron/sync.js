// Cron: daily portfolio sync. For every Base44 app in the registry, pull licenses,
// product-usage counts, and support tickets into the bodega. Idempotent. Scheduled
// once in vercel.json; also runnable on demand. Per-app logic is shared with the
// control endpoints (_lib/sync/*). One function (not three) to stay within the
// Vercel serverless-function budget.
import { supabaseAdmin, requireSupabase, audit } from '../_lib/supabaseAdmin.js'
import { bridgeConfigured } from '../_lib/appBridge.js'
import { syncLicensesForApp } from '../_lib/sync/syncLicenses.js'
import { syncUsageForApp } from '../_lib/sync/syncUsage.js'
import { syncTicketsForApp } from '../_lib/sync/syncTickets.js'

export default async function handler(req, res) {
  // Gate: when CRON_SECRET is set, require it (Vercel sends it as a Bearer);
  // Vercel cron requests also carry the x-vercel-cron header.
  const secret = process.env.CRON_SECRET
  if (secret && req.headers.authorization !== `Bearer ${secret}` && !req.headers['x-vercel-cron']) {
    return res.status(401).json({ error: 'unauthorized' })
  }
  if (!requireSupabase(res)) return

  const { data: apps, error } = await supabaseAdmin.from('apps').select('*').eq('backend', 'base44')
  if (error) return res.status(500).json({ error: error.message })

  if (!bridgeConfigured()) {
    return res.status(200).json({
      ok: true, apps: apps.length, synced: 0,
      note: 'INGEST_HMAC_SECRET no está configurado — ponlo en Vercel y en cada app Base44.',
    })
  }

  const day = new Date().toISOString().slice(0, 10)
  const summary = []
  for (const app of apps) {
    const row = { app: app.id }
    try { row.licenses = await syncLicensesForApp(app) } catch (e) { row.licenses = { error: e.message } }
    try { row.usage = await syncUsageForApp(app, day) } catch (e) { row.usage = { error: e.message } }
    try { row.tickets = await syncTicketsForApp(app) } catch (e) { row.tickets = { error: e.message } }
    summary.push(row)
  }

  await audit('sync', { payload: { day, summary } })
  return res.status(200).json({ ok: true, apps: summary.length, day, summary })
}
