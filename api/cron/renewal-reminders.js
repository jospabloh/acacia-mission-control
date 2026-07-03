// Cron: renovación/recordatorio mensual (día 1). Para cada app, sobre los tenants
// vencidos o por vencer este mes:
//   - cobro automático (auto_renew) y NO suspendido/cancelado → EXTIENDE la
//     licencia al 1° del mes siguiente (asume que Mercado Pago cobró el día 1) y
//     manda el aviso de cargo (renewal_fyi). Queda "pendiente de verificar" para
//     que el operador confirme el cargo en Licencias.
//   - pago manual → recordatorio amable de pago (renewal), sin tocar la licencia.
// Idempotente por mes vía renewal_reminders (unique app+external_id+period).
// La lógica de negocio pura vive en _lib/renewalReminders.js.
import { supabaseAdmin, requireSupabase, audit } from '../_lib/supabaseAdmin.js'
import { callBridge, bridgeConfigured } from '../_lib/appBridge.js'
import { messagingFor } from '../_lib/messaging.js'
import { resolveRecipients, sendFollowup } from '../_lib/emailFollowup.js'
import { licenseControlFor, buildLicenseChange } from '../_lib/licenseControl.js'
import { syncLicensesForApp } from '../_lib/sync/syncLicenses.js'
import { currentPeriodKey, qualifiesForReminder, reminderKindFor, shouldAutoRenew } from '../_lib/renewalReminders.js'

const DAY = 86_400_000

// Extiende la licencia un mes, aterrizando el 1° del mes siguiente (cobro MP el
// día 1). Devuelve { newExpiry } o { error }. No lanza.
async function autoRenewLicense(app, lic, period, now) {
  const licCfg = licenseControlFor(app.id)
  if (!licCfg) return { error: `sin control de licencia para ${app.id}` }
  const change = buildLicenseChange(app.id, 'confirm_payment', {
    periodMonths: 1, currentExpiry: lic.current_period_end, now,
    actorEmail: 'auto-renovación (MP)', paymentReference: `auto:${period}`,
    dayConventionOverride: 'first_of_month',
  })
  if (change.error) return { error: change.error }
  if (change.log) change.log.row[licCfg.audit.idField] = lic.external_id
  try {
    await callBridge(app, 'license.set', { entity: licCfg.entity, id: lic.external_id, patch: change.patch, log: change.log })
    return { newExpiry: change.newExpiry }
  } catch (e) {
    return { error: e.message }
  }
}

// Envía los recordatorios/renovaciones de todas las apps. `now` inyectable.
// No lanza por app/tenant: agrega los errores al resumen.
async function runRenewalReminders(now) {
  if (!bridgeConfigured()) return { skipped: 'bridge not configured', apps: [] }
  const period = currentPeriodKey(now)

  const { data: apps, error } = await supabaseAdmin.from('apps').select('*').eq('backend', 'base44')
  if (error) throw new Error(error.message)

  const summary = []
  for (const app of (apps ?? [])) {
    const cfg = messagingFor(app.id)
    if (!cfg) continue
    const row = { app: app.id, sent: 0, renewed: 0, skipped: 0, failed: 0 }

    const { data: lics, error: lErr } = await supabaseAdmin
      .from('licenses').select('external_id, current_period_end, auto_renew, status').eq('app_id', app.id)
    if (lErr) { row.error = lErr.message; summary.push(row); continue }
    const due = (lics ?? []).filter((l) => qualifiesForReminder(l, now))
    if (due.length === 0) { summary.push(row); continue }

    let byId = {}
    try {
      const recipients = await resolveRecipients(app, cfg)
      byId = Object.fromEntries(recipients.map((r) => [r.id, r]))
    } catch (e) { row.error = `contactos: ${e.message}`; summary.push(row); continue }

    let didRenew = false
    for (const lic of due) {
      const recipient = byId[lic.external_id]
      if (!recipient?.email) { row.skipped++; continue }
      // En cobro automático pero suspendido/cancelado: no se renueva ni se avisa.
      if (lic.auto_renew && !shouldAutoRenew(lic)) { row.skipped++; continue }
      const autoRenew = shouldAutoRenew(lic)
      const kind = reminderKindFor(lic)

      // Reclama el envío (idempotencia). El unique rechaza un duplicado → ya se
      // atendió este mes, saltamos.
      const { error: claimErr } = await supabaseAdmin.from('renewal_reminders')
        .insert({ app_id: app.id, external_id: lic.external_id, period, kind, recipient: recipient.email })
      if (claimErr) { row.skipped++; continue }

      // Renovación automática: extiende la licencia ANTES de avisar.
      let newExpiry = null
      if (autoRenew) {
        const r = await autoRenewLicense(app, lic, period, now)
        if (r.error) {
          // No se pudo renovar: libera la reserva y no mandes aviso engañoso.
          row.failed++
          await supabaseAdmin.from('renewal_reminders').delete()
            .eq('app_id', app.id).eq('external_id', lic.external_id).eq('period', period)
          continue
        }
        newExpiry = r.newExpiry
        didRenew = true
        row.renewed++
      }

      // Correo: aviso de cargo (con la nueva fecha) o recordatorio de pago manual.
      const date = newExpiry || lic.current_period_end
      const days = date ? Math.ceil((new Date(date).getTime() - now.getTime()) / DAY) : null
      const r = await sendFollowup(app, cfg, kind, recipient, { date, days })
      if (r.sent) row.sent++
      else row.failed++ // el correo falló; si ya se renovó, la renovación se mantiene

      // Finaliza el registro (renovado + fecha + pendiente de verificar si aplica).
      await supabaseAdmin.from('renewal_reminders')
        .update({ renewed: !!newExpiry, new_expiry: newExpiry, recipient: recipient.email })
        .eq('app_id', app.id).eq('external_id', lic.external_id).eq('period', period)
    }

    // Refleja las nuevas expiraciones en la bodega (best-effort, una vez por app).
    if (didRenew) { try { await syncLicensesForApp(app) } catch { /* no-op */ } }
    summary.push(row)
  }

  return { period, apps: summary }
}

export default async function handler(req, res) {
  // Mismo gate que el cron de sync: CRON_SECRET (Bearer) o header de Vercel cron.
  const secret = process.env.CRON_SECRET
  if (secret && req.headers.authorization !== `Bearer ${secret}` && !req.headers['x-vercel-cron']) {
    return res.status(401).json({ error: 'unauthorized' })
  }
  if (!requireSupabase(res)) return

  try {
    const result = await runRenewalReminders(new Date())
    await audit('cron:renewal-reminders', { payload: result })
    return res.status(200).json({ ok: true, ...result })
  } catch (e) {
    return res.status(500).json({ error: e.message })
  }
}
