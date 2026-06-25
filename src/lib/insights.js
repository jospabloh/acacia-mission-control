// Pure aggregations for the Analítica page — derived from the synced bodega
// (licenses + tenants). No I/O here so it's unit-testable; the page feeds it
// rows from Supabase.

function toSortedEntries(countMap) {
  return Object.entries(countMap)
    .map(([key, count]) => ({ key, count }))
    .sort((a, b) => b.count - a.count)
}

// Buckets the app's raw statuses into the four we surface as KPIs.
function bucket(status) {
  if (status === 'active') return 'active'
  if (status === 'trial') return 'trial'
  if (status === 'view_only') return 'view_only'
  return 'other'
}

const DAY = 24 * 60 * 60 * 1000

function daysUntil(dateStr, now) {
  if (!dateStr) return null
  const t = Date.parse(dateStr)
  return Number.isNaN(t) ? null : Math.ceil((t - now) / DAY)
}

export function summarizePortfolio({ licenses = [], tenants = [], apps = [], now = Date.now() }) {
  const appName = Object.fromEntries(apps.map((a) => [a.id, a.name]))

  const totals = { licenses: licenses.length, tenants: tenants.length, active: 0, trial: 0, view_only: 0, other: 0, seats: 0 }
  const upcoming = [] // renewals + trial ends within the horizon
  const byStatus = {}
  const byPlan = {}
  const byApp = {}

  const appRow = (id) => (byApp[id] ??= { app_id: id, name: appName[id] ?? id, tenants: 0, licenses: 0, active: 0 })

  for (const l of licenses) {
    const status = l.status || 'desconocido'
    const plan = l.plan || 'sin plan'
    byStatus[status] = (byStatus[status] ?? 0) + 1
    byPlan[plan] = (byPlan[plan] ?? 0) + 1
    totals[bucket(l.status)]++
    totals.seats += Number(l.seats) || 0
    const row = appRow(l.app_id)
    row.licenses++
    if (l.status === 'active') row.active++

    // Renewals (paid period ending) and trials ending, within 45 days.
    const dRenew = daysUntil(l.current_period_end, now)
    if (dRenew !== null && dRenew >= 0 && dRenew <= 45) {
      upcoming.push({ app_id: l.app_id, name: appName[l.app_id] ?? l.app_id, type: 'renovación', in_days: dRenew, date: l.current_period_end })
    }
    const dTrial = daysUntil(l.trial_ends_at, now)
    if (dTrial !== null && dTrial >= 0 && dTrial <= 45) {
      upcoming.push({ app_id: l.app_id, name: appName[l.app_id] ?? l.app_id, type: 'fin de prueba', in_days: dTrial, date: l.trial_ends_at })
    }
  }
  for (const t of tenants) appRow(t.app_id).tenants++

  upcoming.sort((a, b) => a.in_days - b.in_days)

  // Conversion: how much of the base is actually paying (active vs everything).
  const activeRate = totals.licenses ? Math.round((totals.active / totals.licenses) * 100) : 0

  return {
    totals: { ...totals, activeRate },
    byStatus: toSortedEntries(byStatus),
    byPlan: toSortedEntries(byPlan),
    byApp: Object.values(byApp).sort((a, b) => b.tenants - a.tenants || b.licenses - a.licenses),
    upcoming,
    renewals30: upcoming.filter((u) => u.type === 'renovación' && u.in_days <= 30).length,
    trialsEnding14: upcoming.filter((u) => u.type === 'fin de prueba' && u.in_days <= 14).length,
  }
}
