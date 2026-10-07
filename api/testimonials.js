// PUBLIC testimonials feed for acaciaco.com.mx (contract §6). No auth, CORS *,
// cached at the edge. Reads with the service role, but ONLY approved+consented
// rows and ONLY through buildPublicPayload()'s allowlist — nothing else in the
// row (tenant, e-mail, ids) can reach the response.
import { supabaseAdmin, requireSupabase } from './_lib/supabaseAdmin.js'
import { buildPublicPayload } from './_lib/testimonials.js'

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS')
  if (req.method === 'OPTIONS') return res.status(204).end()
  if (req.method !== 'GET') return res.status(405).json({ ok: false, error: 'method not allowed' })
  if (!requireSupabase(res)) return

  const { data, error } = await supabaseAdmin
    .from('testimonials')
    .select('app_id, rating, body, author_name, author_role, status, consent_publish, reviewed_at, submitted_at')
    .eq('status', 'approved').eq('consent_publish', true)
  if (error) return res.status(500).json({ ok: false, error: 'no disponible' })

  const app = typeof req.query?.app === 'string' && req.query.app ? req.query.app : null
  res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=600')
  return res.status(200).json(buildPublicPayload(data ?? [], { app }))
}
