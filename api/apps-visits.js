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
import { aggregateVisits } from './_lib/visitsAggregate.js'
import { pageAll } from './_lib/pageAll.js'

// The 9 portfolio apps: a fixed, hand-maintained list, same reasoning as
// before — a slug added on the site with nothing here just reads back as
// zero visits, never a crash.
const APP_SLUGS = [
  'stockflow', 'flowfin', 'cateqhub',
  'liuma', 'puntos-plus', 'rumbo', 'radar',
  'ctrlhq', 'kitchops', 'artiskids', 'sommel',
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

  const now = new Date()
  // Window start comes from the same helper that buckets the rows, so the two
  // can never disagree: it reaches back to the first day of the previous
  // calendar month (up to ~62 days) instead of the former 30.
  const { windowStart } = aggregateVisits({ rows: [], appSlugs: APP_SLUGS, freewareSlugs, now })

  const knownPaths = [
    ...APP_SLUGS.map((s) => `/apps/${s}`),
    ...freewareSlugs.map((s) => `/freeware/${s}`),
  ]

  // Scoped to known paths and the window above — unlike web-kpis.js (which
  // scans the whole table for its own authenticated dashboard), a public
  // endpoint has no caller-side rate limit, so keep the query itself cheap
  // and narrow rather than relying on restraint from whoever calls it.
  //
  // Paging: the old single `.limit(50_000)` was silently capped by PostgREST's
  // max-rows setting (1000 by default on Supabase) AND would silently truncate
  // with a wider window. So read keyset pages on the primary key (`id`, stable
  // under concurrent inserts, unlike offset paging) via pageAll(), which ends
  // ONLY on an empty page (a short page can just be a lower server max-rows)
  // and stops at 60 pages (60k rows at 1000/page), reporting `truncated: true`
  // instead of quietly under-counting. Cost: one extra cheap query per
  // uncached call, which the edge cache below absorbs.
  let rows, truncated
  try {
    ;({ rows, truncated } = await pageAll(async (afterId) => {
      const { data, error } = await supabaseAdmin
        .from('web_events')
        .select('id, path, day')
        .in('path', knownPaths)
        .gte('day', windowStart)
        .gt('id', afterId)
        .order('id', { ascending: true })
        .limit(1000)
      if (error) throw new Error(error.message)
      return data
    }))
  } catch (e) {
    return res.status(500).json({ error: e.message })
  }

  const { since30, month, visits, freeware, topApp, topFreeware } =
    aggregateVisits({ rows, appSlugs: APP_SLUGS, freewareSlugs, now })

  // Cache at the edge — this backs a page's initial layout, not a live
  // dashboard, and a public unauthenticated endpoint is exactly the kind
  // that should not re-run its query (now two queries, the second one paged
  // over up to ~62 days) on every pageview. 120s is still right: the monthly
  // ranking only changes at month boundaries and the 30/7-day counters are not
  // live numbers.
  res.setHeader('Cache-Control', 'public, max-age=120, s-maxage=120, stale-while-revalidate=600')
  const body = { ok: true, since: since30, visits, freeware, month, topApp, topFreeware }
  if (truncated) body.truncated = true
  return res.status(200).json(body)
}
