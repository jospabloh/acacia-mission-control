// Public, read-only visit counts for the acaciaco.com.mx apps grid — the data
// behind "most visited apps first" on the marketing site. Every apps/*.html
// page fires scripts/analytics.js's tracking pixel to /api/track on load,
// which already lands a { path: '/apps/<slug>', day, visitor } row in
// web_events (see api/track.js). Nothing aggregated that per app before this;
// api/web-kpis.js's byApp rollup exists but attributes by matching web_events
// against apps.url (each app's live product subdomain), and the marketing
// site's own /apps/<slug> pages were never in that registry — so this reads
// the same table with its own narrower, purpose-built query instead of trying
// to bend web-kpis' attribution to fit.
//
// Public and unauthenticated, on purpose: it returns only aggregate pageview
// counts for public marketing pages, the same posture as /api/track itself
// (which anyone can already write to). No member gate, no PII — visitor is
// never selected here.
import { supabaseAdmin, requireSupabase } from './_lib/supabaseAdmin.js'

// Keep in sync with acaciaco-site's apps/*.html slugs. A slug added there with
// nothing here just reads back as zero visits — never a crash — so this list
// drifting behind is silent-degrade, not silent-break.
const KNOWN_SLUGS = [
  'stockflow', 'flowfin', 'cateqhub',
  'liuma', 'puntos-plus', 'rumbo', 'radar',
  'ctrlhq', 'kitchops',
]
const KNOWN_PATHS = KNOWN_SLUGS.map((s) => `/apps/${s}`)

export default async function handler(req, res) {
  // Simple GET has no preflight, but answer OPTIONS defensively anyway.
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS')
  if (req.method === 'OPTIONS') return res.status(204).end()

  if (!requireSupabase(res)) return

  const today = new Date()
  const since30 = new Date(today.getTime() - 29 * 86_400_000).toISOString().slice(0, 10)
  const since7 = new Date(today.getTime() - 6 * 86_400_000).toISOString().slice(0, 10)

  // Scoped to the 9 known app paths and the last 30 days — unlike web-kpis.js
  // (which scans the whole table for its own broader dashboard), a public
  // endpoint has no caller-side rate limit, so keep the query itself cheap
  // and narrow rather than relying on restraint from whoever calls it.
  const { data, error } = await supabaseAdmin
    .from('web_events')
    .select('path, day')
    .in('path', KNOWN_PATHS)
    .gte('day', since30)
    .limit(50_000)
  if (error) return res.status(500).json({ error: error.message })

  const visits = {}
  for (const slug of KNOWN_SLUGS) visits[slug] = { visits30: 0, visits7: 0 }
  for (const row of data ?? []) {
    const slug = row.path.slice('/apps/'.length)
    const v = visits[slug]
    if (!v) continue // path matched the filter but isn't a known slug (shouldn't happen)
    v.visits30++
    if (row.day >= since7) v.visits7++
  }

  // Cache at the edge — this backs a page's initial layout, not a live
  // dashboard, and a public unauthenticated endpoint is exactly the kind
  // that should not re-run its query on every single pageview.
  res.setHeader('Cache-Control', 'public, max-age=120, s-maxage=120, stale-while-revalidate=600')
  return res.status(200).json({ ok: true, since: since30, visits })
}
