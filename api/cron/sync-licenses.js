// Cron: for every Base44 app in the registry, sync its licenses into the bodega.
// Idempotent. Scheduled in vercel.json; also runnable on demand. The per-app
// logic lives in _lib/sync/syncLicenses.js (shared with the control endpoint).
import { supabaseAdmin, requireSupabase, audit } from '../_lib/supabaseAdmin.js'
import { bridgeConfigured } from '../_lib/appBridge.js'
import { syncLicensesForApp } from '../_lib/sync/syncLicenses.js'

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
      summary: apps.map((a) => ({ app: a.id, skipped: 'INGEST_HMAC_SECRET not set' })),
    })
  }

  const summary = []
  for (const app of apps) {
    try { summary.push(await syncLicensesForApp(app)) }
    catch (e) { summary.push({ app: app.id, error: e.message }) }
  }

  await audit('sync-licenses', { payload: { summary } })
  const synced = summary.filter((s) => s.licenses != null)
  return res.status(200).json({ ok: true, apps: summary.length, synced: synced.length, summary })
}
