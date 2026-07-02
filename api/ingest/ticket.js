// Real-time support-ticket PUSH. A Base44 app's `notifyTicketCreated` function
// calls this the instant a customer raises a ticket — server-side, HMAC-signed
// with the same INGEST_HMAC_SECRET as the admin bridge. This is what removes the
// "tengo que darle a sincronizar": the ticket lands in the bodega within seconds
// of creation instead of waiting for the daily pull (api/cron/sync).
//
// The shared upsert + SLA + notification logic lives in _lib/ingestTicket.js so
// the pull variant (ticket-pull.js, for apps that can't host a function) gives
// the identical treatment. Here we just verify the signature and resolve the app.
import { supabaseAdmin, requireSupabase } from '../_lib/supabaseAdmin.js'
import { verify } from '../_lib/ingestSign.js'
import { isTicketMappable } from '../_lib/sync/ticketMapping.js'
import { ticketControlFor } from '../_lib/ticketControl.js'
import { processIncomingTicket } from '../_lib/ingestTicket.js'

const ACTION = 'ticket.ingest'

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method not allowed' })
  if (!requireSupabase(res)) return

  const secret = process.env.INGEST_HMAC_SECRET
  if (!secret) return res.status(503).json({ error: 'INGEST_HMAC_SECRET no configurado' })

  const { app: appId, record, ts, sig } = req.body ?? {}
  if (!appId || !record || !ts || !sig) return res.status(400).json({ error: 'falta app/record/ts/sig' })
  if (!verify({ secret, ts, action: ACTION, params: { app: appId, record }, sig })) {
    return res.status(401).json({ error: 'firma inválida' })
  }
  if (!isTicketMappable(record)) return res.status(400).json({ error: 'record sin id' })
  if (!ticketControlFor(appId)) return res.status(400).json({ error: `app ${appId} no soporta tickets` })

  const { data: app, error: appErr } = await supabaseAdmin.from('apps').select('*').eq('id', appId).maybeSingle()
  if (appErr) return res.status(500).json({ error: appErr.message })
  if (!app) return res.status(404).json({ error: 'app no encontrada' })

  try {
    const result = await processIncomingTicket({ app, record })
    return res.status(result.notified ? 201 : 200).json(result)
  } catch (e) {
    return res.status(500).json({ error: e.message })
  }
}
