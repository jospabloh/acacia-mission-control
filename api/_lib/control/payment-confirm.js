// Control action (WRITE): confirma un payment_reports pendiente — solo rol
// owner. Al confirmar, dispara el mismo camino que license-action.js usa
// para 'confirm_payment' (buildLicenseChange + license.set + resync +
// correo de agradecimiento), y estampa confirmed_by/confirmed_at en el reporte.
import { supabaseAdmin, requireSupabase, audit } from '../supabaseAdmin.js'
import { callBridge, bridgeConfigured } from '../appBridge.js'
import { requireMember } from '../requireMember.js'
import { licenseControlFor, buildLicenseChange, deriveMirror } from '../licenseControl.js'
import { syncLicensesForApp } from '../sync/syncLicenses.js'
import { messagingFor } from '../messaging.js'
import { resolveRecipients, sendFollowup } from '../emailFollowup.js'

export function assertConfirmable(report) {
  if (!report) return { ok: false, error: 'not_found' }
  if (report.confirmed_at) return { ok: false, error: 'already_confirmed' }
  return { ok: true }
}

// Pure guard for the atomic "claim" update below: the update is scoped with
// `.eq('id', reportId).is('confirmed_at', null)` so at most one concurrent
// request can ever flip a given report from unconfirmed → confirmed. If the
// returned row set is empty, someone else won the race (or the row vanished)
// between our read and our write — treat it exactly like assertConfirmable's
// already_confirmed case.
export function evaluateClaim(claimedRows) {
  if (!claimedRows || claimedRows.length === 0) return { ok: false, error: 'already_confirmed' }
  return { ok: true }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method not allowed' })
  if (!requireSupabase(res)) return
  const member = await requireMember(req, res, 'owner')
  if (!member) return

  const { reportId, periodMonths } = req.body ?? {}
  if (!reportId) return res.status(400).json({ error: 'falta reportId' })
  if (!bridgeConfigured()) return res.status(503).json({ error: 'INGEST_HMAC_SECRET no configurado' })

  const { data: report, error: rErr } = await supabaseAdmin.from('payment_reports').select('*').eq('id', reportId).maybeSingle()
  if (rErr) return res.status(500).json({ error: rErr.message })
  const check = assertConfirmable(report)
  if (!check.ok) return res.status(check.error === 'not_found' ? 404 : 409).json({ error: check.error })

  const cfg = licenseControlFor(report.app_id)
  if (!cfg) return res.status(400).json({ error: `app ${report.app_id} no soporta control de licencia` })

  const { data: lic } = await supabaseAdmin
    .from('licenses').select('current_period_end')
    .eq('app_id', report.app_id).eq('external_id', report.external_id).maybeSingle()

  const change = buildLicenseChange(report.app_id, 'confirm_payment', {
    actorEmail: member.email, currentExpiry: lic?.current_period_end ?? null,
    periodMonths: periodMonths || 1, paymentReference: report.reference,
  })
  if (change.error) return res.status(400).json({ error: change.error })
  if (change.log) change.log.row[cfg.audit.idField] = report.external_id // fill the audit record id

  const { data: app, error: aErr } = await supabaseAdmin.from('apps').select('*').eq('id', report.app_id).maybeSingle()
  if (aErr) return res.status(500).json({ error: aErr.message })
  if (!app) return res.status(404).json({ error: 'app no encontrada' })

  // Atomic claim — the real fix for the TOCTOU: two concurrent requests can
  // both pass assertConfirmable's read-then-check above, but only one of
  // them can win this conditional update (`confirmed_at IS NULL` enforced by
  // Postgres, not by JS). Do this *before* touching the license at all, so a
  // loser never calls callBridge in the first place. If callBridge/resync
  // below throws, the catch block rolls this claim back so the report stays
  // retryable — a report must never end up "confirmed" with no license write
  // to show for it.
  const { data: claimedRows, error: claimErr } = await supabaseAdmin
    .from('payment_reports')
    .update({ confirmed_by: member.email, confirmed_at: new Date().toISOString() })
    .eq('id', reportId)
    .is('confirmed_at', null)
    .select()
  if (claimErr) return res.status(500).json({ error: claimErr.message })
  const claim = evaluateClaim(claimedRows)
  if (!claim.ok) return res.status(409).json({ error: claim.error })

  try {
    const out = await callBridge(app, 'license.set', {
      entity: cfg.entity, id: report.external_id, patch: change.patch, log: change.log,
      mirror: deriveMirror(cfg, change.patch),
    })
    let resync = null
    try { resync = await syncLicensesForApp(app) } catch (e) { resync = { error: e.message } }

    let emailed = null
    try {
      const msgCfg = messagingFor(report.app_id)
      if (msgCfg) {
        const recipients = await resolveRecipients(app, msgCfg)
        const recipient = recipients.find((r) => r.id === report.external_id)
        if (recipient) {
          const r = await sendFollowup(app, msgCfg, 'payment_confirmed', recipient, {
            date: change.newExpiry, periodMonths: periodMonths || 1, reference: report.reference,
          })
          emailed = !!r.sent
          if (r.error) console.warn('[payment-confirm] correo de confirmación falló:', r.error)
        }
      }
    } catch (e) { console.warn('[payment-confirm] resolución de destinatario falló:', e.message) }

    await audit('control:payment-confirm', {
      actor: member.user_id, actor_email: member.email, target_app: report.app_id, target_id: report.external_id,
      payload: { reportId, amount: report.amount, newExpiry: change.newExpiry ?? null, emailed },
    })
    return res.status(200).json({ ok: true, applied: !!(out?.ok ?? out?.updated), newExpiry: change.newExpiry ?? null, emailed, resync })
  } catch (e) {
    // The license write (or resync) failed — the claim above already
    // stamped confirmed_by/confirmed_at, but nothing was actually applied.
    // Roll it back so the report reads as pending again and a retry (or a
    // concurrent request) isn't permanently locked out by our own claim.
    await supabaseAdmin.from('payment_reports')
      .update({ confirmed_by: null, confirmed_at: null })
      .eq('id', reportId)
    return res.status(502).json({ error: e.message })
  }
}
