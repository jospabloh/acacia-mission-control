// Read one ticket's conversation. Member-gated (viewer+). For apps with a
// separate message entity (puntos/liuma) it calls the bridge (tickets.thread);
// for rumbo the thread is inline on the synced ticket (`responses[]`), so no
// bridge call is needed. Returns messages in a uniform { body, role, staff,
// name, ts } shape, oldest-first. Read-only.
import { supabaseAdmin, requireSupabase } from '../_lib/supabaseAdmin.js'
import { callBridge, bridgeConfigured } from '../_lib/appBridge.js'
import { requireMember } from '../_lib/requireMember.js'
import { ticketControlFor, normalizeMessage } from '../_lib/ticketControl.js'

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method not allowed' })
  if (!requireSupabase(res)) return
  const member = await requireMember(req, res, 'viewer')
  if (!member) return

  const { appId, ticketExternalId } = req.body ?? {}
  if (!appId || !ticketExternalId) return res.status(400).json({ error: 'falta appId/ticketExternalId' })
  const cfg = ticketControlFor(appId)
  if (!cfg) return res.status(400).json({ error: `app ${appId} no soporta tickets` })

  const { data: ticket, error } = await supabaseAdmin
    .from('tickets').select('raw').eq('app_id', appId).eq('external_id', String(ticketExternalId)).maybeSingle()
  if (error) return res.status(500).json({ error: error.message })
  if (!ticket) return res.status(404).json({ error: 'ticket no encontrado (sincroniza primero)' })

  const tsOf = (m) => Date.parse(m?.ts || 0) || 0
  const sort = (arr) => arr.filter(Boolean).sort((a, b) => tsOf(a) - tsOf(b))

  // Inline thread (rumbo): read straight from the synced ticket.
  if (cfg.thread.mode === 'inline') {
    const arr = Array.isArray(ticket.raw?.[cfg.thread.arrayField]) ? ticket.raw[cfg.thread.arrayField] : []
    return res.status(200).json({ ok: true, messages: sort(arr.map((m) => normalizeMessage(appId, m))) })
  }

  // Separate message entity (puntos/liuma): fetch live via the bridge.
  if (!bridgeConfigured()) return res.status(503).json({ error: 'INGEST_HMAC_SECRET no configurado' })
  const { data: app } = await supabaseAdmin.from('apps').select('*').eq('id', appId).maybeSingle()
  if (!app) return res.status(404).json({ error: 'app no encontrada' })
  try {
    const out = await callBridge(app, 'tickets.thread', {
      messageEntity: cfg.thread.messageEntity, fkField: cfg.thread.fkField, ticketId: String(ticketExternalId),
    })
    const records = out?.records ?? out?.data?.records ?? []
    return res.status(200).json({ ok: true, messages: sort(records.map((m) => normalizeMessage(appId, m))) })
  } catch (e) {
    return res.status(502).json({ error: e.message })
  }
}
