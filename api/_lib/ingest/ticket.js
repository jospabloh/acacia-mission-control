// Real-time support-ticket PUSH. A Base44 app's `notifyTicketCreated` function
// calls this the instant a customer raises a ticket — server-side, HMAC-signed
// with the same INGEST_HMAC_SECRET as the admin bridge. This is what removes the
// "tengo que darle a sincronizar": the ticket lands in the bodega within seconds
// of creation instead of waiting for the daily pull (api/cron/sync).
//
// The shared upsert + SLA + notification logic lives in _lib/ingestTicket.js so
// the pull variant (ticket-pull.js, for apps that can't host a function) gives
// the identical treatment. Here we just verify the signature and resolve the app.
import { supabaseAdmin, requireSupabase } from '../supabaseAdmin.js'
import { verifyFrom } from '../ingestSign.js'
import { isTicketMappable } from '../sync/ticketMapping.js'
import { ticketControlFor } from '../ticketControl.js'
import { processIncomingTicket } from '../ingestTicket.js'

const ACTION = 'ticket.ingest'

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method not allowed' })
  if (!requireSupabase(res)) return

  const secret = process.env.INGEST_HMAC_SECRET
  if (!secret) return res.status(503).json({ error: 'INGEST_HMAC_SECRET no configurado' })

  const { app: appId, record, ts, sig } = req.body ?? {}
  if (!appId || !record || !ts || !sig) return res.status(400).json({ error: 'falta app/record/ts/sig' })
  // The slug selects the key, which is the whole point: a body that NAMES
  // another app is checked against that app's derived key, so relabelling one
  // app's push as another's no longer verifies. Before this, every app signed
  // with the same master, so the `app` field here was an unverified claim and
  // any app could write a ticket under any other app's name (module-14 audit,
  // 2026-08-23). Still accepts a legacy master signature while
  // ACCEPT_LEGACY_MASTER is true — see ingestSign.js for why, and for what
  // flipping it finishes.
  if (!verifyFrom({ master: secret, slug: appId, ts, action: ACTION, params: { app: appId, record }, sig })) {
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
