import { useEffect, useMemo, useState } from 'react'
import { supabase } from './supabase.js'
import { fetchApps } from './appRegistry.js'
import { webKpis } from './control.js'
import { aggregateByApp } from './sessionsView.js'

export const SECTIONS = [
  { key: 'app',      label: 'Apps · SaaS',  sub: 'Control y analíticas en vivo' },
  { key: 'freeware', label: 'Freeware',     sub: 'Catálogo · herramientas gratuitas' },
  { key: 'site',     label: 'Sitios web',   sub: 'Catálogo · páginas y micrositios' },
]

// Shared data fetch for the portfolio views (Dashboard + Products): the app
// registry, per-app tenant/license counts, open-session counts, and web KPIs.
export function usePortfolioData() {
  const [apps, setApps] = useState([])
  const [stats, setStats] = useState({})
  const [kpis, setKpis] = useState(null) // { path: { visits30, visitors30, visits7 } }
  const [byApp, setByApp] = useState({}) // appId -> { visits30, visitors30, visits7 }
  const [sessByApp, setSessByApp] = useState({}) // appId -> { open, online }
  const [error, setError] = useState(null)

  useEffect(() => {
    fetchApps().then(setApps).catch((e) => setError(e.message))

    Promise.all([
      supabase.from('tenants').select('app_id'),
      supabase.from('licenses').select('app_id, status'),
    ]).then(([t, l]) => {
      const s = {}
      const bump = (id) => (s[id] ??= { tenants: 0, licenses: 0, active: 0 })
      for (const r of t.data ?? []) bump(r.app_id).tenants++
      for (const r of l.data ?? []) { const x = bump(r.app_id); x.licenses++; if (r.status === 'active') x.active++ }
      setStats(s)
    }).catch((e) => setError(e.message))

    supabase.from('app_sessions').select('app_id, last_active_at, revoked_at')
      .then(({ data }) => setSessByApp(aggregateByApp(data ?? [], Date.now())))
      .catch((e) => setError(e.message))

    webKpis().then((r) => { setKpis(r.kpis ?? {}); setByApp(r.byApp ?? {}) }).catch(() => { setKpis({}); setByApp({}) })
  }, [])

  const hasKpis = kpis && Object.keys(kpis).length > 0

  const byCat = useMemo(() => {
    const m = { app: [], freeware: [], site: [] }
    for (const a of apps) (m[a.category] ??= []).push(a)
    return m
  }, [apps])

  const totals = useMemo(() => {
    const tenants = Object.values(stats).reduce((n, x) => n + x.tenants, 0)
    const active = Object.values(stats).reduce((n, x) => n + x.active, 0)
    const sessions = Object.values(sessByApp).reduce((n, x) => n + x.open, 0)
    const online = Object.values(sessByApp).reduce((n, x) => n + x.online, 0)
    return { products: apps.length, saas: byCat.app.length, tenants, active, sessions, online }
  }, [apps, stats, byCat, sessByApp])

  return { apps, stats, kpis, byApp, sessByApp, error, hasKpis, byCat, totals }
}
