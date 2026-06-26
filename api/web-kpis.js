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
    .from('web_events').select('path, day, visitor').gte('day', since).limit(100_000)
  if (error) return res.status(500).json({ error: error.message })
  const rows = data ?? []

  // Per-path rollups.
  const acc = {} // path -> { visits30, set, visits7 }
  const visitors30 = new Set()
  const byDay = {} // day -> count
  for (const r of rows) {
    const a = (acc[r.path] ??= { visits30: 0, visitors: new Set(), visits7: 0 })
    a.visits30++
    if (r.visitor) { a.visitors.add(r.visitor); visitors30.add(r.visitor) }
    if (r.day >= since7) a.visits7++
    byDay[r.day] = (byDay[r.day] ?? 0) + 1
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

  return res.status(200).json({
    ok: true,
    totals: { visits30: rows.length, visitors30: visitors30.size },
    kpis, top: top.slice(0, 12), series, since,
  })
}
