// Public lead ingest. The acaciaco.com.mx contact form (and any landing) can POST
// a lead here; it lands in the bodega's `leads` table (status 'new') for the CRM
// pillar. Validated + length-capped; CORS-open (it's a public form target). If
// INGEST_LEAD_SECRET is set, an `x-lead-secret` header must match.
import { supabaseAdmin, requireSupabase } from '../_lib/supabaseAdmin.js'

const cap = (v, n) => (v == null ? null : String(v).slice(0, n))
const looksEmail = (e) => typeof e === 'string' && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Headers', 'content-type, x-lead-secret')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  if (req.method === 'OPTIONS') return res.status(204).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'method not allowed' })
  if (!requireSupabase(res)) return

  const secret = process.env.INGEST_LEAD_SECRET
  if (secret && req.headers['x-lead-secret'] !== secret) return res.status(401).json({ error: 'unauthorized' })

  const b = req.body ?? {}
  const name = cap(b.name, 200)
  const email = cap(b.email, 255)
  if (!name && !looksEmail(email)) return res.status(400).json({ error: 'se requiere nombre o email válido' })

  const lead = {
    source: cap(b.source, 80) || 'acaciaco.com.mx',
    name, email: looksEmail(email) ? email : null,
    phone: cap(b.phone, 40),
    app_interest: cap(b.app_interest ?? b.interest, 80),
    message: cap(b.message, 4000),
    status: 'new',
    raw: typeof b === 'object' ? b : {},
  }
  const { error } = await supabaseAdmin.from('leads').insert(lead)
  if (error) return res.status(500).json({ error: error.message })
  return res.status(201).json({ ok: true })
}
