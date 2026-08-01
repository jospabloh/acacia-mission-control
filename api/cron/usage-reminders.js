// Cron diario: recordatorio de uso (motivacional). Para cada app, sella
// tenants.last_seen_active_at de cualquier tenant con un contacto activo hoy
// (app_sessions, sesión abierta) y, para tenants con licencia activa sin
// actividad reciente, manda una invitación cálida a volver — nunca una
// advertencia de licencia (eso ya lo cubren renewal-reminders/license-lifecycle).
// Idempotente por mes vía usage_reminders (unique app+external_id+period).
// La lógica de negocio pura vive en _lib/usageReminders.js.
import { supabaseAdmin, requireSupabase, audit } from '../_lib/supabaseAdmin.js'
import { bridgeConfigured } from '../_lib/appBridge.js'
import { messagingFor } from '../_lib/messaging.js'
import { resolveRecipients, sendFollowup } from '../_lib/emailFollowup.js'
import { qualifiesForUsageReminder, usagePeriodKey } from '../_lib/usageReminders.js'

async function runUsageReminders(now) {
  if (!bridgeConfigured()) return { skipped: 'bridge not configured', apps: [] }
  const period = usagePeriodKey(now)

  const { data: apps, error } = await supabaseAdmin.from('apps').select('*').eq('backend', 'base44')
  if (error) throw new Error(error.message)

  const summary = []
  for (const app of (apps ?? [])) {
    const cfg = messagingFor(app.id)
    if (!cfg) continue
    const row = { app: app.id, seen: 0, sent: 0, skipped: 0, failed: 0 }

    const { data: tenants, error: tErr } = await supabaseAdmin
      .from('tenants').select('external_id, raw, created_at, last_seen_active_at').eq('app_id', app.id)
    if (tErr) { row.error = tErr.message; summary.push(row); continue }
    if (!tenants?.length) { summary.push(row); continue }

    const { data: sessions, error: sErr } = await supabaseAdmin
      .from('app_sessions').select('user_email').eq('app_id', app.id)
    if (sErr) { row.error = sErr.message; summary.push(row); continue }
    const activeToday = new Set((sessions ?? []).map((s) => s.user_email).filter(Boolean))

    const { data: lics, error: lErr } = await supabaseAdmin
      .from('licenses').select('external_id, status').eq('app_id', app.id)
    if (lErr) { row.error = lErr.message } // no bloquea — solo faltará el filtro de status
    const licByExt = Object.fromEntries((lics ?? []).map((l) => [l.external_id, l]))

    let byId = {}
    try {
      const recipients = await resolveRecipients(app, cfg)
      byId = Object.fromEntries(recipients.map((r) => [r.id, r]))
    } catch (e) { row.error = `contactos: ${e.message}`; summary.push(row); continue }

    for (const tenant of tenants) {
      const recipient = byId[tenant.external_id]
      if (!recipient?.email) continue

      // Activo hoy: sella el reloj de "última vez visto" (app_sessions se
      // purga a las 24h — esta columna es la que persiste) y sigue de largo.
      if (activeToday.has(recipient.email)) {
        row.seen++
        await supabaseAdmin.from('tenants').update({ last_seen_active_at: now.toISOString() })
          .eq('app_id', app.id).eq('external_id', tenant.external_id)
        continue
      }

      const license = licByExt[tenant.external_id]
      if (!qualifiesForUsageReminder({ tenant, license, now })) continue

      // Reclama el envío (idempotencia mensual).
      const { error: claimErr } = await supabaseAdmin.from('usage_reminders')
        .insert({ app_id: app.id, external_id: tenant.external_id, period, kind: 'usage_reminder', recipient: recipient.email })
      if (claimErr) { row.skipped++; continue } // ya se mandó este mes

      const r = await sendFollowup(app, cfg, 'usage_reminder', recipient, {})
      if (r.sent) row.sent++
      else {
        row.failed++
        await supabaseAdmin.from('usage_reminders').delete()
          .eq('app_id', app.id).eq('external_id', tenant.external_id).eq('period', period)
      }
    }
    summary.push(row)
  }

  return { period, apps: summary }
}

export default async function handler(req, res) {
  // Mismo gate que los demás crons: CRON_SECRET (Bearer) o header de Vercel cron.
  const secret = process.env.CRON_SECRET
  if (secret && req.headers.authorization !== `Bearer ${secret}` && !req.headers['x-vercel-cron']) {
    return res.status(401).json({ error: 'unauthorized' })
  }
  if (!requireSupabase(res)) return

  try {
    const result = await runUsageReminders(new Date())
    await audit('cron:usage-reminders', { payload: result })
    return res.status(200).json({ ok: true, ...result })
  } catch (e) {
    return res.status(500).json({ error: e.message })
  }
}
