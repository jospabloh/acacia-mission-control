// Real-time support-ticket PULL. For apps that can't host the notifyTicketCreated
// function (StockFlow / FlowFin hit Base44's 50-function-per-app cap), the app's
// frontend simply pings Mission Control with a ticket id — no signing, no app
// function. Mission Control then reads the AUTHORITATIVE record straight from the
// app via the existing acaciaControl bridge (tickets.list, HMAC-signed from MC's
// side) and runs the same upsert + SLA + notification as the push path.
//
// Trust model: the body carries no ticket data we trust — only {app, ticketId}.
// MC fetches the real record from the app itself, so a forged body can't inject a
// fake ticket; an unknown id just no-ops. CORS-open because it's a browser target.
import { supabaseAdmin, requireSupabase } from '../supabaseAdmin.js'
import { callBridge, bridgeConfigured } from '../appBridge.js'
import { ticketControlFor } from '../ticketControl.js'
import { processIncomingTicket } from '../ingestTicket.js'

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Headers', 'content-type')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  if (req.method === 'OPTIONS') return res.status(204).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'method not allowed' })
  if (!requireSupabase(res)) return
  if (!bridgeConfigured()) return res.status(503).json({ error: 'INGEST_HMAC_SECRET no configurado' })

  const { app: appId, ticketId } = req.body ?? {}
  if (!appId || ticketId == null || String(ticketId) === '') {
    return res.status(400).json({ error: 'falta app/ticketId' })
  }
  const cfg = ticketControlFor(appId)
  if (!cfg) return res.status(400).json({ error: `app ${appId} no soporta tickets` })

  const { data: app, error: appErr } = await supabaseAdmin.from('apps').select('*').eq('id', appId).maybeSingle()
  if (appErr) return res.status(500).json({ error: appErr.message })
  if (!app) return res.status(404).json({ error: 'app no encontrada' })

  // Read the authoritative record from the app via the bridge, then pick the one.
  let record
  try {
    const out = await callBridge(app, 'tickets.list', { entity: cfg.entity })
    const records = out?.records ?? out?.data?.records ?? []
    record = records.find((r) => String(r?.id) === String(ticketId)) ?? null
  } catch (e) {
    return res.status(502).json({ error: `bridge: ${e.message}` })
  }
  if (!record) return res.status(404).json({ error: 'ticket no encontrado en la app' })

  try {
    const result = await processIncomingTicket({ app, record })
    return res.status(result.notified ? 201 : 200).json(result)
  } catch (e) {
    return res.status(500).json({ error: e.message })
  }
}
