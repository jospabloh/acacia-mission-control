// Send a Comunicado (renewal | campaign | maintenance) to one or many tenants of
// an app, via the bridge emails.sendFollowup. Admin-gated. Customer-facing — the
// UI gates every send behind an explicit preview + confirmation with the count.
import { supabaseAdmin, requireSupabase, audit } from '../_lib/supabaseAdmin.js'
import { callBridge, bridgeConfigured } from '../_lib/appBridge.js'
import { requireMember } from '../_lib/requireMember.js'
import { messagingFor, renderMessage } from '../_lib/messaging.js'

const MAX_RECIPIENTS = 200 // hard cap per request

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method not allowed' })
  if (!requireSupabase(res)) return
  const member = await requireMember(req, res, 'admin')
  if (!member) return

  const { appId, type, recipients, subject, body, maint } = req.body ?? {}
  if (!appId || !type || !Array.isArray(recipients) || recipients.length === 0) {
    return res.status(400).json({ error: 'falta appId/type/recipients' })
  }
  if (!['renewal', 'campaign', 'maintenance'].includes(type)) return res.status(400).json({ error: 'type inválido' })
  if (recipients.length > MAX_RECIPIENTS) return res.status(400).json({ error: `máximo ${MAX_RECIPIENTS} destinatarios por envío` })
  if (type === 'campaign' && !body) return res.status(400).json({ error: 'la campaña necesita cuerpo' })
  if (!bridgeConfigured()) return res.status(503).json({ error: 'INGEST_HMAC_SECRET no configurado' })

  const cfg = messagingFor(appId)
  if (!cfg) return res.status(400).json({ error: `app ${appId} no soporta comunicados` })

  const { data: app, error } = await supabaseAdmin.from('apps').select('*').eq('id', appId).maybeSingle()
  if (error) return res.status(500).json({ error: error.message })
  if (!app) return res.status(404).json({ error: 'app no encontrada' })

  // Renewal needs each tenant's expiry — pull it from the bodega (external_id = record id).
  let dateByExt = {}
  if (type === 'renewal') {
    const { data: lic } = await supabaseAdmin.from('licenses').select('external_id, current_period_end, trial_ends_at').eq('app_id', appId)
    dateByExt = Object.fromEntries((lic ?? []).map((l) => [l.external_id, l.current_period_end || l.trial_ends_at]))
  }
  const now = Date.now()

  const results = []
  for (const r of recipients) {
    if (!r?.email) { results.push({ id: r?.id, skipped: 'sin email' }); continue }
    const date = type === 'renewal' ? dateByExt[r.id] : null
    const days = date ? Math.max(0, Math.ceil((new Date(date).getTime() - now) / 86_400_000)) : null
    const { subject: subj, html } = renderMessage(type, { app: cfg, tenantName: r.name, date, days, subject, body, maint })

    const log = cfg.log && r.id
      ? { entity: cfg.log.entity, row: { [cfg.log.idField]: r.id, email_type: `mc_${type}`, recipient_email: r.email, status: 'sent', notification_key: `mc:${type}:${r.id}:${new Date().toISOString().slice(0, 10)}` } }
      : undefined

    try {
      await callBridge(app, 'emails.sendFollowup', { to: r.email, subject: subj, html, log })
      results.push({ id: r.id, email: r.email, sent: true })
    } catch (e) {
      results.push({ id: r.id, email: r.email, error: e.message })
    }
  }

  const sent = results.filter((x) => x.sent).length
  const failed = results.filter((x) => x.error).length
  await audit('control:send-message', {
    actor: member.user_id, actor_email: member.email, target_app: appId,
    payload: { type, count: recipients.length, sent, failed, subject: subject ?? null },
  })
  return res.status(200).json({ ok: true, type, sent, failed, results })
}
