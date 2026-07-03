// Cron: daily portfolio sync. For every Base44 app, pull licenses, product-usage
// counts and support tickets; for EVERY app (Base44 + sites/external) record a
// health probe. Idempotent. Scheduled once in vercel.json; also runnable on
// demand. Per-app logic is shared with the control endpoints (_lib/sync/*). One
// function (not several) to stay within the Vercel serverless-function budget.
import { supabaseAdmin, requireSupabase, audit } from '../_lib/supabaseAdmin.js'
import { bridgeConfigured } from '../_lib/appBridge.js'
import { syncLicensesForApp } from '../_lib/sync/syncLicenses.js'
import { syncUsageForApp } from '../_lib/sync/syncUsage.js'
import { syncTicketsForApp } from '../_lib/sync/syncTickets.js'
import { sweepAutoCloseForApp } from '../_lib/sweepResolvedTickets.js'
import { probeAppHealth } from '../_lib/sync/syncHealth.js'

export default async function handler(req, res) {
  // Gate: when CRON_SECRET is set, require it (Vercel sends it as a Bearer);
  // Vercel cron requests also carry the x-vercel-cron header.
  const secret = process.env.CRON_SECRET
  if (secret && req.headers.authorization !== `Bearer ${secret}` && !req.headers['x-vercel-cron']) {
    return res.status(401).json({ error: 'unauthorized' })
  }
  if (!requireSupabase(res)) return

  const { data: apps, error } = await supabaseAdmin.from('apps').select('*')
  if (error) return res.status(500).json({ error: error.message })

  const day = new Date().toISOString().slice(0, 10)
  const haveBridge = bridgeConfigured()
  const summary = []
  for (const app of apps) {
    const row = { app: app.id }
    // Health applies to every app (Base44 bridge ping or HTTP probe for sites).
    try { row.health = await probeAppHealth(app) } catch (e) { row.health = { error: e.message } }
    // The data syncs are Base44-only and need the bridge secret.
    if (app.backend === 'base44' && haveBridge) {
      try { row.licenses = await syncLicensesForApp(app) } catch (e) { row.licenses = { error: e.message } }
      try { row.usage = await syncUsageForApp(app, day) } catch (e) { row.usage = { error: e.message } }
      try { row.tickets = await syncTicketsForApp(app) } catch (e) { row.tickets = { error: e.message } }
      // After the sync reflects each app's latest state, close tickets that have
      // sat "resolved" past the grace window with no further requester activity.
      try { row.autoClose = await sweepAutoCloseForApp(app) } catch (e) { row.autoClose = { error: e.message } }
    }
    summary.push(row)
  }

  await audit('sync', { payload: { day, bridge: haveBridge, summary } })
  return res.status(200).json({ ok: true, apps: summary.length, day, summary })
}
