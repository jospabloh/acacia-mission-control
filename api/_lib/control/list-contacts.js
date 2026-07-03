// Read tenant recipient contacts for an app (admin-gated), via the bridge
// tenants.contacts using the app's recipient spec. Returns [{ id, name, email }]
// with an email. Names are enriched from the bodega's tenants table when the
// license record itself carries none (e.g. liuma's SchoolSubscription).
import { supabaseAdmin, requireSupabase } from '../supabaseAdmin.js'
import { bridgeConfigured } from '../appBridge.js'
import { requireMember } from '../requireMember.js'
import { messagingFor } from '../messaging.js'
import { resolveRecipients } from '../emailFollowup.js'

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

  let withEmail
  try {
    withEmail = await resolveRecipients(app, cfg)
  } catch (e) {
    return res.status(502).json({ error: e.message })
  }

  return res.status(200).json({ ok: true, contacts: withEmail, withEmail: withEmail.length })
}
