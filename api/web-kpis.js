// Aggregated web KPIs for the Analytics pillar. Member-gated (viewer+). Reads the
// last 30 days of web_events via service_role and returns: per-path rollups
// (visits 30d, unique visitors 30d, visits 7d), portfolio totals, top paths, and
// a 14-day daily visits series for a sparkline. Low-volume friendly.
import { supabaseAdmin, requireSupabase } from './_lib/supabaseAdmin.js'
import { requireMember } from './_lib/requireMember.js'

export default async function handler(req, res) {
  if (!requireSupabase(res)) return
  const member = await requireMember(req, res, 'viewer')
  if (!member) return

  const today = new Date()
  const since = new Date(today.getTime() - 29 * 86_400_000).toISOString().slice(0, 10)
  const since7 = new Date(today.getTime() - 6 * 86_400_000).toISOString().slice(0, 10)

  const { data, error } = await supabaseAdmin
    .from('web_events').select('host, path, day, visitor').gte('day', since).limit(100_000)
  if (error) return res.status(500).json({ error: error.message })
  const rows = data ?? []

  // Catalog attribution: map each pageview to EVERY registry app whose host matches
  // and whose path prefix contains it. Attribution is nested, not exclusive: a "site"
  // row (prefix "/") counts ALL its pages (/, /mundial-2026, /servicios…) AND each
  // sub-site (/baristop, /mundial-2026, /freeware/*) also keeps its own slice — the
  // same pageview to /mundial-2026 counts for both the root site and that micro-site.
  // (A single longest-prefix winner would rob the root of every sub-site's traffic.)
  // www. is normalized away.
  const norm = (h) => (h || '').replace(/^www\./i, '').toLowerCase()
  const { data: appRows } = await supabaseAdmin.from('apps').select('id, url')
  const catalog = (appRows ?? []).flatMap((a) => {
    try { const u = new URL(a.url); return [{ id: a.id, host: norm(u.host), prefix: u.pathname.replace(/\/+$/, '') }] }
    catch { return [] }
  })
  function attribute(host, path) {
    const h = norm(host)
    const ids = []
    for (const c of catalog) {
      if (c.host !== h) continue
      const ok = c.prefix === '' ? true : (path === c.prefix || path.startsWith(c.prefix + '/'))
      if (ok) ids.push(c.id)
    }
    return ids
  }

  // Per-path rollups (top routes) + per-app rollups (catalog cards).
  const acc = {} // path -> { visits30, set, visits7 }
  const byApp = {} // appId -> { visits30, visitors:Set, visits7 }
  const visitors30 = new Set()
  const byDay = {} // day -> count
  for (const r of rows) {
    const a = (acc[r.path] ??= { visits30: 0, visitors: new Set(), visits7: 0 })
    a.visits30++
    if (r.visitor) { a.visitors.add(r.visitor); visitors30.add(r.visitor) }
    if (r.day >= since7) a.visits7++
    byDay[r.day] = (byDay[r.day] ?? 0) + 1

    for (const appId of attribute(r.host, r.path)) {
      const b = (byApp[appId] ??= { visits30: 0, visitors: new Set(), visits7: 0 })
      b.visits30++
      if (r.visitor) b.visitors.add(r.visitor)
      if (r.day >= since7) b.visits7++
    }
  }
  const byAppKpis = {}
  for (const [id, b] of Object.entries(byApp)) {
    byAppKpis[id] = { visits30: b.visits30, visitors30: b.visitors.size, visits7: b.visits7 }
  }
  const kpis = {}
  const top = []
  for (const [path, a] of Object.entries(acc)) {
    kpis[path] = { visits30: a.visits30, visitors30: a.visitors.size, visits7: a.visits7 }
    top.push({ path, visits30: a.visits30, visitors30: a.visitors.size })
  }
  top.sort((x, y) => y.visits30 - x.visits30)

  // 14-day daily visits series (zero-filled).
  const series = []
  for (let i = 13; i >= 0; i--) {
    const d = new Date(today.getTime() - i * 86_400_000).toISOString().slice(0, 10)
    series.push({ day: d, visits: byDay[d] ?? 0 })
  }

  // Never cache: KPIs must reflect events recorded seconds ago (a stale cached
  // response made a fresh pageview look like "0 visits" in the Sitios catalog).
  res.setHeader('Cache-Control', 'no-store, max-age=0')
  return res.status(200).json({
    ok: true,
    totals: { visits30: rows.length, visitors30: visitors30.size },
    kpis, byApp: byAppKpis, top: top.slice(0, 12), series, since,
  })
}
