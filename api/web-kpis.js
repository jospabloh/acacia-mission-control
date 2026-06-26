// Aggregated web KPIs per path for the dashboard (Freeware/Sitios). Member-gated
// (viewer+). Reads the last 30 days of web_events via service_role and rolls them
// up: visits 30d, unique visitors 30d, visits last 7d. Low-volume friendly.
import { supabaseAdmin, requireSupabase } from './_lib/supabaseAdmin.js'
import { requireMember } from './_lib/requireMember.js'

export default async function handler(req, res) {
  if (!requireSupabase(res)) return
  const member = await requireMember(req, res, 'viewer')
  if (!member) return

  const since = new Date(Date.now() - 29 * 86_400_000).toISOString().slice(0, 10)
  const since7 = new Date(Date.now() - 6 * 86_400_000).toISOString().slice(0, 10)

  const { data, error } = await supabaseAdmin
    .from('web_events').select('path, day, visitor').gte('day', since).limit(50_000)
  if (error) return res.status(500).json({ error: error.message })

  const acc = {} // path -> { visits30, set<visitor>, visits7 }
  for (const r of data ?? []) {
    const a = (acc[r.path] ??= { visits30: 0, visitors: new Set(), visits7: 0 })
    a.visits30++
    if (r.visitor) a.visitors.add(r.visitor)
    if (r.day >= since7) a.visits7++
  }
  const kpis = {}
  for (const [path, a] of Object.entries(acc)) {
    kpis[path] = { visits30: a.visits30, visitors30: a.visitors.size, visits7: a.visits7 }
  }
  return res.status(200).json({ ok: true, kpis, since })
}
