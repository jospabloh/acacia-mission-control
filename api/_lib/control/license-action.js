// Control action (WRITE): change one tenant's license in its app — reactivate,
// suspend, set view-only, or change plan — via the acaciaControl `license.set`
// bridge. Admin-gated (operator session, admin+). After the write, re-syncs the
// app's licenses so the bodega reflects the change immediately.
import { supabaseAdmin, requireSupabase, audit } from '../supabaseAdmin.js'
import { callBridge, bridgeConfigured } from '../appBridge.js'
import { requireMember } from '../requireMember.js'
import { licenseControlFor, buildLicenseChange, deriveMirror, OP_LABEL } from '../licenseControl.js'
import { syncLicensesForApp } from '../sync/syncLicenses.js'
import { messagingFor } from '../messaging.js'
import { resolveRecipients, sendFollowup } from '../emailFollowup.js'

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method not allowed' })
  if (!requireSupabase(res)) return
  const member = await requireMember(req, res, 'admin')
  if (!member) return

  const { appId, licenseExternalId, op, plan, periodMonths, paymentReference, sendEmail, addonKey, addonValue } = req.body ?? {}
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

  const change = buildLicenseChange(appId, op, { plan, actorEmail: member.email, currentExpiry, periodMonths, paymentReference, addonKey, addonValue })
  if (change.error) return res.status(400).json({ error: change.error })
  if (change.log) change.log.row[cfg.audit.idField] = licenseExternalId // fill the audit record id

  const { data: app, error } = await supabaseAdmin.from('apps').select('*').eq('id', appId).maybeSingle()
  if (error) return res.status(500).json({ error: error.message })
  if (!app) return res.status(404).json({ error: 'app no encontrada' })

  try {
    // mirror: keeps a per-tenant User-entity mirror (e.g. cateqhub's
    // parish_plan/parish_license_status/parish_support_priority_addon) in
    // sync with whatever this write actually touched — previously only the
    // license-lifecycle cron did this derivation; a manual op through this
    // endpoint (reactivate/suspend/set_plan/set_addon/…) left the mirror
    // stale until the next cron tick. Harmless no-op for apps without
    // cfg.mirror (deriveMirror returns undefined).
    const out = await callBridge(app, 'license.set', {
      entity: cfg.entity, id: licenseExternalId, patch: change.patch, log: change.log,
      mirror: deriveMirror(cfg, change.patch),
    })
    // Reflect the change in the bodega right away (best-effort).
    let resync = null
    try { resync = await syncLicensesForApp(app) } catch (e) { resync = { error: e.message } }

    // Correo de agradecimiento al admin de la tienda tras confirmar el pago.
    // Best-effort: si falla, el pago ya quedó aplicado; nunca revierte el write.
    // `emailed`: true (enviado) | false (falló/omitido) | null (no aplica/sin sendEmail).
    let emailed = null
    if (op === 'confirm_payment' && sendEmail !== false) {
      emailed = false
      try {
        const msgCfg = messagingFor(appId)
        if (msgCfg) {
          const recipients = await resolveRecipients(app, msgCfg)
          const recipient = recipients.find((r) => r.id === licenseExternalId)
          if (recipient) {
            const r = await sendFollowup(app, msgCfg, 'payment_confirmed', recipient, {
              date: change.newExpiry, periodMonths, reference: paymentReference,
            })
            emailed = !!r.sent
            if (r.error) console.warn('[license-action] correo de confirmación falló:', r.error)
          } else {
            console.warn('[license-action] sin destinatario resoluble para', appId, licenseExternalId)
          }
        }
      } catch (e) {
        console.warn('[license-action] resolución de destinatario falló:', e.message)
      }
    }

    await audit('control:license-action', {
      actor: member.user_id, actor_email: member.email, target_app: appId, target_id: licenseExternalId,
      payload: { op, plan: plan ?? null, label: OP_LABEL[op] ?? op, patch: change.patch, newExpiry: change.newExpiry ?? null, emailed },
    })
    return res.status(200).json({ ok: true, op, applied: !!(out?.ok ?? out?.updated), newExpiry: change.newExpiry ?? null, emailed, resync })
  } catch (e) {
    return res.status(502).json({ error: e.message })
  }
}
