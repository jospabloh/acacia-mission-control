// Public, read-only visit counts for acaciaco.com.mx's card grids — the data
// behind "most visited first" on the marketing site. Every apps/*.html and
// freeware/*.html page fires scripts/analytics.js's tracking pixel to
// /api/track on load, which already lands a { path, day, visitor } row in
// web_events (see api/track.js). Nothing aggregated that per card before
// this; api/web-kpis.js's byApp rollup exists but attributes by matching
// web_events against apps.url (each app's live product subdomain), and the
// marketing site's own /apps/<slug> and /freeware/<slug> pages were never in
// that registry for the 9 SaaS apps — so this reads the same table with its
// own narrower, purpose-built query instead of trying to bend web-kpis'
// attribution to fit.
//
// Public and unauthenticated, on purpose: it returns only aggregate pageview
// counts for public marketing pages, the same posture as /api/track itself
// (which anyone can already write to). No member gate, no PII — visitor is
// never selected here.
import { supabaseAdmin, requireSupabase } from './_lib/supabaseAdmin.js'

// The 9 portfolio apps: a fixed, hand-maintained list, same reasoning as
// before — a slug added on the site with nothing here just reads back as
// zero visits, never a crash.
const APP_SLUGS = [
  'stockflow', 'flowfin', 'cateqhub',
  'liuma', 'puntos-plus', 'rumbo', 'radar',
  'ctrlhq', 'kitchops', 'artiskids',
]

export default async function handler(req, res) {
  // Simple GET has no preflight, but answer OPTIONS defensively anyway.
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS')
  if (req.method === 'OPTIONS') return res.status(204).end()

  if (!requireSupabase(res)) return

  // Freeware tools are NOT hand-maintained here, unlike APP_SLUGS — there
  // are ~20 of them, they get added over time (see supabase/migrations/
  // 0029_seed_metodo_cubetas.sql, 0032_seed_gastos_viaje.sql, each its own
  // migration), and hand-syncing a list here against that would drift the
  // same way api/web-kpis.js's own header warns about. Instead, derive it
  // from the same apps registry web-kpis.js already trusts: category
  // 'freeware' rows carry a real acaciaco.com.mx/freeware/<slug> URL, so the
  // slug is just that path's last segment.
  const { data: freewareRows, error: freewareErr } = await supabaseAdmin
    .from('apps').select('id, url').eq('category', 'freeware')
  if (freewareErr) return res.status(500).json({ error: freewareErr.message })
  const freewareSlugs = (freewareRows ?? []).flatMap((a) => {
    try {
      const u = new URL(a.url)
      const m = u.pathname.match(/^\/freeware\/([^/]+)\/?$/)
      return m ? [m[1]] : []
    } catch { return [] }
  })

  const today = new Date()
  const since30 = new Date(today.getTime() - 29 * 86_400_000).toISOString().slice(0, 10)
  const since7 = new Date(today.getTime() - 6 * 86_400_000).toISOString().slice(0, 10)

  const knownPaths = [
    ...APP_SLUGS.map((s) => `/apps/${s}`),
    ...freewareSlugs.map((s) => `/freeware/${s}`),
  ]

  // Scoped to known paths and the last 30 days — unlike web-kpis.js (which
  // scans the whole table for its own authenticated dashboard), a public
  // endpoint has no caller-side rate limit, so keep the query itself cheap
  // and narrow rather than relying on restraint from whoever calls it.
  const { data, error } = await supabaseAdmin
    .from('web_events')
    .select('path, day')
    .in('path', knownPaths)
    .gte('day', since30)
    .limit(50_000)
  if (error) return res.status(500).json({ error: error.message })

  const visits = {}
  for (const slug of APP_SLUGS) visits[slug] = { visits30: 0, visits7: 0 }
  const freeware = {}
  for (const slug of freewareSlugs) freeware[slug] = { visits30: 0, visits7: 0 }

  for (const row of data ?? []) {
    let bucket, slug
    if (row.path.startsWith('/apps/')) {
      slug = row.path.slice('/apps/'.length)
      bucket = visits[slug]
    } else if (row.path.startsWith('/freeware/')) {
      slug = row.path.slice('/freeware/'.length)
      bucket = freeware[slug]
    }
    if (!bucket) continue // path matched the filter but isn't a known slug (shouldn't happen)
    bucket.visits30++
    if (row.day >= since7) bucket.visits7++
  }

  // Cache at the edge — this backs a page's initial layout, not a live
  // dashboard, and a public unauthenticated endpoint is exactly the kind
  // that should not re-run its query (now two queries) on every pageview.
  res.setHeader('Cache-Control', 'public, max-age=120, s-maxage=120, stale-while-revalidate=600')
  return res.status(200).json({ ok: true, since: since30, visits, freeware })
}
