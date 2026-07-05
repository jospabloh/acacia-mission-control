// Control action (READ): list ONE app's end-user sessions LIVE via the
// acaciaControl bridge (`sessions.list`), normalized and grouped by user with
// idle/state computed server-side (single clock). Powers the AppDetail "Sesiones
// activas" panel, which needs freshness the synced bodega copy can't guarantee.
// Admin-gated. POST { appId }.
import { supabaseAdmin, requireSupabase } from '../supabaseAdmin.js'
import { callBridge, bridgeConfigured } from '../appBridge.js'
import { requireMember } from '../requireMember.js'
import { normalizeOpenSessions, groupByUser, summarize } from '../sessions.js'

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method not allowed' })
  if (!requireSupabase(res)) return
  const member = await requireMember(req, res, 'admin')
  if (!member) return

  const { appId } = req.body ?? {}
  if (!appId) return res.status(400).json({ error: 'falta appId' })
  if (!bridgeConfigured()) return res.status(503).json({ error: 'INGEST_HMAC_SECRET no configurado' })

  const { data: app, error } = await supabaseAdmin.from('apps').select('*').eq('id', appId).maybeSingle()
  if (error) return res.status(500).json({ error: error.message })
  if (!app) return res.status(404).json({ error: 'app no encontrada' })

  const entity = app.config?.session_entity
  if (!entity) return res.status(400).json({ error: 'esta app no reporta sesiones', supported: false })

  let result
  try {
    result = await callBridge(app, 'sessions.list', { entity })
  } catch (e) {
    return res.status(502).json({ error: e.message })
  }
  const records = result?.records ?? result?.data?.records ?? []
  const now = Date.now()
  const sessions = normalizeOpenSessions(records, now)

  return res.status(200).json({
    ok: true,
    supported: true,
    totals: summarize(sessions),
    users: groupByUser(sessions),
    fetched_at: new Date(now).toISOString(),
  })
}
