// Send a Comunicado (renewal | campaign | maintenance) to one or many tenants of
// an app, via the bridge emails.sendFollowup. Admin-gated. Customer-facing — the
// UI gates every send behind an explicit preview + confirmation with the count.
import { supabaseAdmin, requireSupabase, audit } from '../supabaseAdmin.js'
import { bridgeConfigured } from '../appBridge.js'
import { requireMember } from '../requireMember.js'
import { messagingFor } from '../messaging.js'
import { sendFollowup } from '../emailFollowup.js'

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
  if (!['renewal', 'renewal_fyi', 'trial_offer', 'campaign', 'maintenance'].includes(type)) return res.status(400).json({ error: 'type inválido' })
  if (recipients.length > MAX_RECIPIENTS) return res.status(400).json({ error: `máximo ${MAX_RECIPIENTS} destinatarios por envío` })
  if (type === 'campaign' && !body) return res.status(400).json({ error: 'la campaña necesita cuerpo' })
  if (!bridgeConfigured()) return res.status(503).json({ error: 'INGEST_HMAC_SECRET no configurado' })

  const cfg = messagingFor(appId)
  if (!cfg) return res.status(400).json({ error: `app ${appId} no soporta comunicados` })

  const { data: app, error } = await supabaseAdmin.from('apps').select('*').eq('id', appId).maybeSingle()
  if (error) return res.status(500).json({ error: error.message })
  if (!app) return res.status(404).json({ error: 'app no encontrada' })

  // Renewal-style messages need each tenant's expiry — pull it from the bodega
  // (external_id = record id). renewal_fyi (on a plan) shows the paid expiry;
  // renewal (manual reminder) falls back to trial end when no paid period yet.
  const DATED = new Set(['renewal', 'renewal_fyi'])
  let dateByExt = {}
  if (DATED.has(type)) {
    const { data: lic } = await supabaseAdmin.from('licenses').select('external_id, current_period_end, trial_ends_at').eq('app_id', appId)
    dateByExt = Object.fromEntries((lic ?? []).map((l) => [l.external_id, l.current_period_end || l.trial_ends_at]))
  }
  const now = Date.now()

  const results = []
  for (const r of recipients) {
    if (!r?.email) { results.push({ id: r?.id, skipped: 'sin email' }); continue }
    const date = DATED.has(type) ? dateByExt[r.id] : null
    const days = date ? Math.max(0, Math.ceil((new Date(date).getTime() - now) / 86_400_000)) : null
    const out = await sendFollowup(app, cfg, type, r, { date, days, subject, body, maint })
    results.push(out.sent ? { id: r.id, email: r.email, sent: true } : { id: r.id, email: r.email, error: out.error })
  }

  const sent = results.filter((x) => x.sent).length
  const failed = results.filter((x) => x.error).length
  await audit('control:send-message', {
    actor: member.user_id, actor_email: member.email, target_app: appId,
    payload: { type, count: recipients.length, sent, failed, subject: subject ?? null },
  })
  return res.status(200).json({ ok: true, type, sent, failed, results })
}
