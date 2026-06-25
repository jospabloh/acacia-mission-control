// Read-only control action: fetch follow-up email history for one tenant of an
// app, via the acaciaControl bridge (emails.status). Admin-gated. Returns the
// app's email-log rows (email_type, status, sent_at) or { supported:false } when
// the app keeps no email log. No writes, no customer email is sent.
import { supabaseAdmin, requireSupabase } from '../_lib/supabaseAdmin.js'
import { callBridge, bridgeConfigured } from '../_lib/appBridge.js'
import { requireMember } from '../_lib/requireMember.js'

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method not allowed' })
  if (!requireSupabase(res)) return
  const member = await requireMember(req, res, 'viewer')
  if (!member) return

  const { appId, tenantExternalId } = req.body ?? {}
  if (!appId || !tenantExternalId) return res.status(400).json({ error: 'falta appId/tenantExternalId' })
  if (!bridgeConfigured()) return res.status(503).json({ error: 'INGEST_HMAC_SECRET no configurado' })

  const { data: app, error } = await supabaseAdmin.from('apps').select('*').eq('id', appId).maybeSingle()
  if (error) return res.status(500).json({ error: error.message })
  if (!app) return res.status(404).json({ error: 'app no encontrada' })

  const log = app.config?.email_log
  if (!log?.entity || !log?.id_field) return res.status(200).json({ ok: true, supported: false, records: [] })

  try {
    const out = await callBridge(app, 'emails.status', { logEntity: log.entity, idField: log.id_field, id: tenantExternalId })
    const records = out?.records ?? out?.data?.records ?? []
    return res.status(200).json({ ok: true, supported: true, records })
  } catch (e) {
    return res.status(502).json({ error: e.message })
  }
}
