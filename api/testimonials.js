// PUBLIC testimonials feed for acaciaco.com.mx (contract §6). No auth, CORS *,
// cached at the edge for at most 60 s (max-age=0 for browsers; no stale-while-revalidate: a withdrawn
// testimonial must stop being served within that bound). Reads with the service role, but ONLY approved+consented
// rows and ONLY through buildPublicPayload()'s allowlist — nothing else in the
// row (tenant, e-mail, ids) can reach the response.
import { supabaseAdmin, requireSupabase } from './_lib/supabaseAdmin.js'
import { buildPublicPayload, appIdForSlug, fetchAllPages } from './_lib/testimonials.js'

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS')
  if (req.method === 'OPTIONS') return res.status(204).end()
  if (req.method !== 'GET') return res.status(405).json({ ok: false, error: 'method not allowed' })
  if (!requireSupabase(res)) return

  const app = typeof req.query?.app === 'string' && req.query.app ? req.query.app : null
  // ALL approved rows, paged (the API caps one response at 1000), newest first
  // with an id tiebreak so pages never skip or repeat; the app filter runs in
  // the query, so the summary counts the whole feed, not a subset.
  let data
  try {
    data = await fetchAllPages(async (from, to) => {
      let q = supabaseAdmin
        .from('testimonials')
        .select('id, app_id, rating, body, author_name, author_role, status, consent_publish, reviewed_at, submitted_at')
        .eq('status', 'approved').eq('consent_publish', true)
      if (app) q = q.eq('app_id', appIdForSlug(app))
      const { data: rows, error } = await q
        .order('reviewed_at', { ascending: false, nullsFirst: false }).order('id', { ascending: false }).range(from, to)
      if (error) throw new Error(error.message)
      return rows ?? []
    })
  } catch {
    return res.status(500).json({ ok: false, error: 'no disponible' })
  }
  // max-age=0: browsers revalidate too (s-maxage alone leaves heuristic freshness to them).
  res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=60')
  return res.status(200).json(buildPublicPayload(data, { app }))
}
