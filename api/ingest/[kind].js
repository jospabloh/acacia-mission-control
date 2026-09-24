// Dynamic ingest router — ONE Vercel serverless function for every
// `/api/ingest/<kind>` endpoint, same reason as api/control/[action].js: the
// Hobby plan caps api/ at 12 functions, and tenant-pull was the thirteenth.
// Handler bodies live under api/_lib/ingest/ (underscore-prefixed → never
// their own functions); the public URLs the apps call are unchanged.
import lead from '../_lib/ingest/lead.js'
import ticket from '../_lib/ingest/ticket.js'
import ticketPull from '../_lib/ingest/ticket-pull.js'
import tenantPull from '../_lib/ingest/tenant-pull.js'

const ROUTES = {
  'lead': lead,
  'ticket': ticket,
  'ticket-pull': ticketPull,
  'tenant-pull': tenantPull,
}

export default async function handler(req, res) {
  const kind = req.query?.kind
  const fn = ROUTES[kind]
  if (!fn) return res.status(404).json({ error: `ingest desconocido: ${kind ?? '∅'}` })
  return fn(req, res)
}
