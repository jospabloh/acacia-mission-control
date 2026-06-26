// Control action (WRITE): reply to a support ticket or change its status, via the
// acaciaControl `tickets.update` bridge. Admin-gated. After the write, re-syncs
// the app's tickets so the bodega reflects the change. POST:
//   { appId, ticketExternalId, op: 'reply'|'status', body?, status? }
import { supabaseAdmin, requireSupabase, audit } from '../_lib/supabaseAdmin.js'
import { callBridge, bridgeConfigured } from '../_lib/appBridge.js'
import { requireMember } from '../_lib/requireMember.js'
import { ticketControlFor, buildTicketReply, buildTicketStatus } from '../_lib/ticketControl.js'
import { syncTicketsForApp } from '../_lib/sync/syncTickets.js'

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method not allowed' })
  if (!requireSupabase(res)) return
  const member = await requireMember(req, res, 'admin')
  if (!member) return

  const { appId, ticketExternalId, op, body, status } = req.body ?? {}
  if (!appId || !ticketExternalId || !op) return res.status(400).json({ error: 'falta appId/ticketExternalId/op' })
  if (!bridgeConfigured()) return res.status(503).json({ error: 'INGEST_HMAC_SECRET no configurado' })
  const cfg = ticketControlFor(appId)
  if (!cfg) return res.status(400).json({ error: `app ${appId} no soporta tickets` })

  // Load the synced ticket so reply builders can read counters / inline thread.
  const { data: ticket, error: tErr } = await supabaseAdmin
    .from('tickets').select('raw').eq('app_id', appId).eq('external_id', String(ticketExternalId)).maybeSingle()
  if (tErr) return res.status(500).json({ error: tErr.message })
  if (!ticket) return res.status(404).json({ error: 'ticket no encontrado (sincroniza primero)' })

  let change
  if (op === 'reply') {
    change = buildTicketReply(appId, { ticketRaw: ticket.raw, body, actorEmail: member.email, actorName: 'ACACIA Soporte' })
  } else if (op === 'status') {
    change = buildTicketStatus(appId, { ticketRaw: ticket.raw, status })
  } else {
    return res.status(400).json({ error: `op desconocida: ${op}` })
  }
  if (change.error) return res.status(400).json({ error: change.error })

  const { data: app, error } = await supabaseAdmin.from('apps').select('*').eq('id', appId).maybeSingle()
  if (error) return res.status(500).json({ error: error.message })
  if (!app) return res.status(404).json({ error: 'app no encontrada' })

  try {
    const { entity, id, patch, messageEntity, message, appendField, appendItem, currentArray } = change
    await callBridge(app, 'tickets.update', { entity, id, patch, messageEntity, message, appendField, appendItem, currentArray })
    let resync = null
    try { resync = await syncTicketsForApp(app) } catch (e) { resync = { error: e.message } }
    await audit('control:ticket-action', {
      actor: member.user_id, actor_email: member.email, target_app: appId, target_id: String(ticketExternalId),
      payload: { op, status: status ?? null, patch },
    })
    return res.status(200).json({ ok: true, op, resync })
  } catch (e) {
    return res.status(502).json({ error: e.message })
  }
}
