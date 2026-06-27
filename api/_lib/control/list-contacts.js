// Read tenant recipient contacts for an app (admin-gated), via the bridge
// tenants.contacts using the app's recipient spec. Returns [{ id, name, email }]
// with an email. Names are enriched from the bodega's tenants table when the
// license record itself carries none (e.g. liuma's SchoolSubscription).
import { supabaseAdmin, requireSupabase } from '../supabaseAdmin.js'
import { callBridge, bridgeConfigured } from '../appBridge.js'
import { requireMember } from '../requireMember.js'
import { messagingFor } from '../messaging.js'

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method not allowed' })
  if (!requireSupabase(res)) return
  const member = await requireMember(req, res, 'admin')
  if (!member) return

  const { appId } = req.body ?? {}
  if (!appId) return res.status(400).json({ error: 'falta appId' })
  if (!bridgeConfigured()) return res.status(503).json({ error: 'INGEST_HMAC_SECRET no configurado' })
  const cfg = messagingFor(appId)
  if (!cfg) return res.status(400).json({ error: `app ${appId} no soporta comunicados` })

  const { data: app, error } = await supabaseAdmin.from('apps').select('*').eq('id', appId).maybeSingle()
  if (error) return res.status(500).json({ error: error.message })
  if (!app) return res.status(404).json({ error: 'app no encontrada' })

  let contacts
  try {
    const out = await callBridge(app, 'tenants.contacts', { entity: cfg.entity, recipient: cfg.recipient })
    contacts = out?.contacts ?? out?.data?.contacts ?? []
  } catch (e) {
    return res.status(502).json({ error: e.message })
  }

  // Enrich missing names from the synced tenants table (external_id = record id).
  const { data: tenants } = await supabaseAdmin.from('tenants').select('external_id, name').eq('app_id', appId)
  const nameByExt = Object.fromEntries((tenants ?? []).map((t) => [t.external_id, t.name]))
  const withEmail = contacts
    .filter((c) => c.email)
    .map((c) => ({ id: c.id, email: c.email, name: c.name || nameByExt[c.id] || null }))

  return res.status(200).json({ ok: true, contacts: withEmail, total: contacts.length, withEmail: withEmail.length })
}
