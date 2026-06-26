// Per-tenant consumption for one app (Analytics F2.2). Member-gated (viewer+).
// Counts the app's primary usage entity grouped by its tenant FK via the bridge
// (usage.byTenant), then enriches tenant names from the bodega. Counts only — no
// customer record data leaves the app.
import { supabaseAdmin, requireSupabase } from '../_lib/supabaseAdmin.js'
import { callBridge, bridgeConfigured } from '../_lib/appBridge.js'
import { requireMember } from '../_lib/requireMember.js'
import { usageByTenantFor } from '../_lib/usageByTenant.js'

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method not allowed' })
  if (!requireSupabase(res)) return
  const member = await requireMember(req, res, 'viewer')
  if (!member) return

  const { appId } = req.body ?? {}
  if (!appId) return res.status(400).json({ error: 'falta appId' })
  if (!bridgeConfigured()) return res.status(503).json({ error: 'INGEST_HMAC_SECRET no configurado' })
  const cfg = usageByTenantFor(appId)
  if (!cfg) return res.status(400).json({ error: `app ${appId} no soporta consumo por tenant` })

  const { data: app, error } = await supabaseAdmin.from('apps').select('*').eq('id', appId).maybeSingle()
  if (error) return res.status(500).json({ error: error.message })
  if (!app) return res.status(404).json({ error: 'app no encontrada' })

  let top
  try {
    const out = await callBridge(app, 'usage.byTenant', { entity: cfg.entity, tenantField: cfg.tenantField })
    top = out?.top ?? out?.data?.top ?? []
  } catch (e) {
    return res.status(502).json({ error: e.message })
  }

  const { data: tenants } = await supabaseAdmin.from('tenants').select('external_id, name').eq('app_id', appId)
  const nameByExt = Object.fromEntries((tenants ?? []).map((t) => [t.external_id, t.name]))
  const rows = top.map((x) => ({ id: x.id, name: nameByExt[x.id] || null, count: x.count }))

  return res.status(200).json({ ok: true, label: cfg.label, entity: cfg.entity, top: rows })
}
