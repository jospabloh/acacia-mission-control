// On-demand control action: sync ONE app's licenses and/or usage right now,
// triggered by an admin from the app's control panel. Same per-app logic as the
// daily crons, but gated by the operator's Supabase session (admin+) instead of
// CRON_SECRET. POST { appId, kinds?: ['licenses','usage','tickets'] }.
import { supabaseAdmin, requireSupabase, audit } from '../_lib/supabaseAdmin.js'
import { bridgeConfigured } from '../_lib/appBridge.js'
import { requireMember } from '../_lib/requireMember.js'
import { syncLicensesForApp } from '../_lib/sync/syncLicenses.js'
import { syncUsageForApp } from '../_lib/sync/syncUsage.js'
import { syncTicketsForApp } from '../_lib/sync/syncTickets.js'
import { probeAppHealth } from '../_lib/sync/syncHealth.js'

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method not allowed' })
  if (!requireSupabase(res)) return

  const member = await requireMember(req, res, 'admin')
  if (!member) return

  const { appId, kinds = ['licenses', 'usage'] } = req.body ?? {}
  if (!appId) return res.status(400).json({ error: 'falta appId' })
  if (!bridgeConfigured()) return res.status(503).json({ error: 'INGEST_HMAC_SECRET no configurado' })

  const { data: app, error } = await supabaseAdmin.from('apps').select('*').eq('id', appId).maybeSingle()
  if (error) return res.status(500).json({ error: error.message })
  if (!app) return res.status(404).json({ error: 'app no encontrada' })

  // Health works for any backend (bridge ping or HTTP probe). The data syncs
  // need the Base44 bridge.
  const dataKinds = ['licenses', 'usage', 'tickets'].filter((k) => kinds.includes(k))
  if (dataKinds.length && app.backend !== 'base44') {
    return res.status(400).json({ error: 'esta app no tiene puente operable' })
  }

  const result = {}
  try {
    if (kinds.includes('health')) result.health = await probeAppHealth(app)
    if (kinds.includes('licenses')) result.licenses = await syncLicensesForApp(app)
    if (kinds.includes('usage')) result.usage = await syncUsageForApp(app, new Date().toISOString().slice(0, 10))
    if (kinds.includes('tickets')) result.tickets = await syncTicketsForApp(app)
  } catch (e) {
    return res.status(502).json({ error: e.message, partial: result })
  }

  await audit('control:run-sync', { actor: member.user_id, actor_email: member.email, target_app: appId, payload: { kinds, result } })
  return res.status(200).json({ ok: true, app: appId, result })
}
