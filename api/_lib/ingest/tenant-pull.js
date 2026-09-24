// Real-time "new tenant" ping (STANDARD Module 1). Same trust model as
// ticket-pull.js: the body carries only {app, tenantId}; nothing in it is
// trusted. Mission Control re-reads the app's license entity through the
// HMAC-signed acaciaControl bridge (syncLicensesForApp), and the notice fires
// only for a tenant that really exists in the app and is new to the bodega —
// so a forged ping can't invent a customer, and a repeat ping is a no-op.
// CORS-open because the app's browser calls it right after signup.
import { supabaseAdmin, requireSupabase } from '../supabaseAdmin.js'
import { bridgeConfigured } from '../appBridge.js'
import { syncLicensesForApp } from '../sync/syncLicenses.js'

const ID_RE = /^[A-Za-z0-9_-]{6,64}$/

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Headers', 'content-type')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  if (req.method === 'OPTIONS') return res.status(204).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'method not allowed' })
  if (!requireSupabase(res)) return
  if (!bridgeConfigured()) return res.status(503).json({ error: 'INGEST_HMAC_SECRET no configurado' })

  const { app: appId, tenantId } = req.body ?? {}
  if (!appId || !ID_RE.test(String(tenantId ?? ''))) return res.status(400).json({ error: 'falta app/tenantId' })

  const { data: app, error: appErr } = await supabaseAdmin.from('apps').select('*').eq('id', appId).maybeSingle()
  if (appErr) return res.status(500).json({ error: appErr.message })
  if (!app) return res.status(404).json({ error: 'app no encontrada' })

  // Already known → nothing to announce; skip the bridge round-trip entirely.
  const { data: known } = await supabaseAdmin
    .from('tenants').select('id').eq('app_id', appId).eq('external_id', String(tenantId)).maybeSingle()
  if (known) return res.status(200).json({ ok: true, notified: false, reason: 'tenant ya conocido' })

  try {
    const result = await syncLicensesForApp(app, { via: 'ping' })
    const mine = (result.newTenants ?? []).find((t) => t.externalId === String(tenantId))
    return res.status(mine?.notified ? 201 : 200).json({ ok: true, tenant: mine ?? null, sync: { records: result.records, skipped: result.skipped } })
  } catch (e) {
    return res.status(500).json({ error: e.message })
  }
}
