// Support-ticket control, one function (Vercel function budget). Ops:
//   - op:'thread'  → read a ticket's conversation (viewer+). For apps with a
//     separate message entity (puntos/liuma) it calls the bridge tickets.thread;
//     for rumbo the thread is inline on the synced ticket (responses[]).
//   - op:'reply'   → post a staff reply (admin+) via bridge tickets.update.
//   - op:'status'  → change the ticket status (admin+) via bridge tickets.update.
// Writes re-sync the app's tickets so the bodega reflects the change.
import { supabaseAdmin, requireSupabase, audit } from '../supabaseAdmin.js'
import { callBridge, bridgeConfigured } from '../appBridge.js'
import { requireMember } from '../requireMember.js'
import { ticketControlFor, normalizeMessage, buildTicketReply, buildTicketStatus, originalMessageThread } from '../ticketControl.js'
import { syncTicketsForApp } from '../sync/syncTickets.js'

// Audit row for a ticket write that did not go through. Pure, so it is tested.
// The message is capped: a bridge error can carry a whole upstream body.
export function failureAuditFields({ member, appId, ticketExternalId, op, status, code, error }) {
  return {
    actor: member?.user_id ?? null, actor_email: member?.email ?? null,
    target_app: appId, target_id: String(ticketExternalId),
    payload: { op, status: status ?? null, http: code, error: String(error ?? '').slice(0, 500) },
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method not allowed' })
  if (!requireSupabase(res)) return

  const { appId, ticketExternalId, op, body, status } = req.body ?? {}
  if (!appId || !ticketExternalId || !op) return res.status(400).json({ error: 'falta appId/ticketExternalId/op' })
  const cfg = ticketControlFor(appId)
  if (!cfg) return res.status(400).json({ error: `app ${appId} no soporta tickets` })

  // Reads need viewer; writes need admin.
  const member = await requireMember(req, res, op === 'thread' ? 'viewer' : 'admin')
  if (!member) return

  // Load the synced ticket (raw) — needed by every op.
  const { data: ticket, error: tErr } = await supabaseAdmin
    .from('tickets').select('raw').eq('app_id', appId).eq('external_id', String(ticketExternalId)).maybeSingle()
  if (tErr) return res.status(500).json({ error: tErr.message })
  if (!ticket) return res.status(404).json({ error: 'ticket no encontrado (sincroniza primero)' })

  const sort = (arr) => arr.filter(Boolean).sort((a, b) => (Date.parse(a?.ts || 0) || 0) - (Date.parse(b?.ts || 0) || 0))

  // ── READ: thread ───────────────────────────────────────────────────────────
  if (op === 'thread') {
    // No thread entity (artiskids, sommel): the original message is the thread.
    if (!cfg.thread) return res.status(200).json({ ok: true, messages: originalMessageThread(ticket.raw) })
    if (cfg.thread.mode === 'inline') {
      const arr = Array.isArray(ticket.raw?.[cfg.thread.arrayField]) ? ticket.raw[cfg.thread.arrayField] : []
      const replies = sort(arr.map((m) => normalizeMessage(appId, m)))
      // The first message lives on the ticket itself (sommel's `body`), not in the array.
      const first = cfg.thread.includeOriginal ? originalMessageThread(ticket.raw) : []
      return res.status(200).json({ ok: true, messages: [...first, ...replies] })
    }
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

  // ── WRITE: reply | status ────────────────────────────────────────────────────
  // A failed write is audited too, with its error: a reply that never reached
  // the app otherwise leaves no trace at all (2026-10-02, Sommel QA ticket).
  const failed = async (code, error) => {
    await audit('control:ticket-action-failed', failureAuditFields({ member, appId, ticketExternalId, op, status, code, error }))
    return res.status(code).json({ error })
  }
  if (!bridgeConfigured()) return failed(503, 'INGEST_HMAC_SECRET no configurado')
  let change
  if (op === 'reply') {
    change = buildTicketReply(appId, { ticketRaw: ticket.raw, body, actorEmail: member.email, actorName: 'ACACIA Soporte' })
  } else if (op === 'status') {
    change = buildTicketStatus(appId, { ticketRaw: ticket.raw, status })
  } else {
    return failed(400, `op desconocida: ${op}`)
  }
  if (change.error) return failed(400, change.error)

  const { data: app, error } = await supabaseAdmin.from('apps').select('*').eq('id', appId).maybeSingle()
  if (error) return failed(500, error.message)
  if (!app) return failed(404, 'app no encontrada')

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
    return failed(502, e.message)
  }
}
