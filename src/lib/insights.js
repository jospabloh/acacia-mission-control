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

export function summarizePortfolio({ licenses = [], tenants = [], apps = [] }) {
  const appName = Object.fromEntries(apps.map((a) => [a.id, a.name]))

  const totals = { licenses: licenses.length, tenants: tenants.length, active: 0, trial: 0, view_only: 0, other: 0 }
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
    const row = appRow(l.app_id)
    row.licenses++
    if (l.status === 'active') row.active++
  }
  for (const t of tenants) appRow(t.app_id).tenants++

  // Conversion: how much of the base is actually paying (active vs everything).
  const activeRate = totals.licenses ? Math.round((totals.active / totals.licenses) * 100) : 0

  return {
    totals: { ...totals, activeRate },
    byStatus: toSortedEntries(byStatus),
    byPlan: toSortedEntries(byPlan),
    byApp: Object.values(byApp).sort((a, b) => b.tenants - a.tenants || b.licenses - a.licenses),
  }
}
