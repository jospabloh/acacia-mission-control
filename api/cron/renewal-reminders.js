// Cron: recordatorio mensual de pago (día 1). Para cada app manda a los tenants
// vencidos o por vencer este mes el correo que corresponde a su modo de cobro
// (recordatorio manual vs aviso de cargo automático). Idempotente por mes vía la
// tabla renewal_reminders. Programado en vercel.json ("0 15 1 * *", ~9am MX).
// La lógica de negocio (qué califica / qué correo) es pura y vive en
// _lib/renewalReminders.js; aquí queda solo la orquestación con bodega + puente.
import { supabaseAdmin, requireSupabase, audit } from '../_lib/supabaseAdmin.js'
import { bridgeConfigured } from '../_lib/appBridge.js'
import { messagingFor } from '../_lib/messaging.js'
import { resolveRecipients, sendFollowup } from '../_lib/emailFollowup.js'
import { currentPeriodKey, qualifiesForReminder, reminderKindFor } from '../_lib/renewalReminders.js'

const DAY = 86_400_000

// Envía los recordatorios de todas las apps. `now` inyectable para determinismo.
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
    const row = { app: app.id, sent: 0, skipped: 0, failed: 0 }

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

    for (const lic of due) {
      const recipient = byId[lic.external_id]
      if (!recipient?.email) { row.skipped++; continue }
      const kind = reminderKindFor(lic)

      // Reclama el envío (idempotencia). El unique(app,external_id,period) rechaza
      // un duplicado → ya se avisó este mes, saltamos.
      const { error: claimErr } = await supabaseAdmin.from('renewal_reminders')
        .insert({ app_id: app.id, external_id: lic.external_id, period, kind, recipient: recipient.email })
      if (claimErr) { row.skipped++; continue }

      const date = lic.current_period_end
      const days = date ? Math.ceil((new Date(date).getTime() - now.getTime()) / DAY) : null
      const r = await sendFollowup(app, cfg, kind, recipient, { date, days })
      if (r.sent) {
        row.sent++
      } else {
        // El envío falló: libera la reserva para poder reintentar luego.
        row.failed++
        await supabaseAdmin.from('renewal_reminders')
          .delete().eq('app_id', app.id).eq('external_id', lic.external_id).eq('period', period)
      }
    }
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
