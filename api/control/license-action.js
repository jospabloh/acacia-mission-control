// Control action (WRITE): change one tenant's license in its app — reactivate,
// suspend, set view-only, or change plan — via the acaciaControl `license.set`
// bridge. Admin-gated (operator session, admin+). After the write, re-syncs the
// app's licenses so the bodega reflects the change immediately.
import { supabaseAdmin, requireSupabase, audit } from '../_lib/supabaseAdmin.js'
import { callBridge, bridgeConfigured } from '../_lib/appBridge.js'
import { requireMember } from '../_lib/requireMember.js'
import { licenseControlFor, buildLicenseChange, OP_LABEL } from '../_lib/licenseControl.js'
import { syncLicensesForApp } from '../_lib/sync/syncLicenses.js'

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method not allowed' })
  if (!requireSupabase(res)) return
  const member = await requireMember(req, res, 'admin')
  if (!member) return

  const { appId, licenseExternalId, op, plan, periodMonths, paymentReference } = req.body ?? {}
  if (!appId || !licenseExternalId || !op) return res.status(400).json({ error: 'falta appId/licenseExternalId/op' })
  if (!bridgeConfigured()) return res.status(503).json({ error: 'INGEST_HMAC_SECRET no configurado' })

  const cfg = licenseControlFor(appId)
  if (!cfg) return res.status(400).json({ error: `app ${appId} no soporta control de licencia` })

  // For a payment confirmation we extend from the current expiry on record. Read
  // it server-side from the bodega (don't trust the client) so the renewal stacks
  // correctly: future expiry → extend it; expired/trial → start from today.
  let currentExpiry = null
  if (op === 'confirm_payment') {
    const { data: lic } = await supabaseAdmin
      .from('licenses').select('current_period_end')
      .eq('app_id', appId).eq('external_id', licenseExternalId).maybeSingle()
    currentExpiry = lic?.current_period_end ?? null
  }

  const change = buildLicenseChange(appId, op, { plan, actorEmail: member.email, currentExpiry, periodMonths, paymentReference })
  if (change.error) return res.status(400).json({ error: change.error })
  if (change.log) change.log.row[cfg.audit.idField] = licenseExternalId // fill the audit record id

  const { data: app, error } = await supabaseAdmin.from('apps').select('*').eq('id', appId).maybeSingle()
  if (error) return res.status(500).json({ error: error.message })
  if (!app) return res.status(404).json({ error: 'app no encontrada' })

  try {
    const out = await callBridge(app, 'license.set', {
      entity: cfg.entity, id: licenseExternalId, patch: change.patch, log: change.log,
    })
    // Reflect the change in the bodega right away (best-effort).
    let resync = null
    try { resync = await syncLicensesForApp(app) } catch (e) { resync = { error: e.message } }

    await audit('control:license-action', {
      actor: member.user_id, actor_email: member.email, target_app: appId, target_id: licenseExternalId,
      payload: { op, plan: plan ?? null, label: OP_LABEL[op] ?? op, patch: change.patch, newExpiry: change.newExpiry ?? null },
    })
    return res.status(200).json({ ok: true, op, applied: !!(out?.ok ?? out?.updated), newExpiry: change.newExpiry ?? null, resync })
  } catch (e) {
    return res.status(502).json({ error: e.message })
  }
}
