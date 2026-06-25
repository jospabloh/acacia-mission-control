import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase.js'
import { fetchApps } from '../lib/appRegistry.js'
import { PageHeader, StatCard } from '../components/PageHeader.jsx'
import { Icon } from '../components/icons.jsx'

const BACKEND_LABEL = { base44: 'Base44', supabase: 'Supabase', external: 'Externo', static: 'Estático' }

const SECTIONS = [
  { key: 'app',      label: 'Apps · SaaS',  sub: 'Operadas por Mission Control' },
  { key: 'freeware', label: 'Freeware',     sub: 'Herramientas gratuitas' },
  { key: 'site',     label: 'Sitios web',   sub: 'Páginas y micrositios' },
]

// open-in-new-tab affordance shared by every actionable tile
function OpenIcon() {
  return <Icon name="external" size={14} className="text-ink-faint transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-brand" />
}

// SaaS app: instrumented — live status, synced stats, opens the app + a detail door.
function AppCard({ app, stat }) {
  return (
    <div className="rounded-xl border border-hair bg-paper-card hover:border-brand/40 hover:shadow-card transition">
      <a href={app.url} target="_blank" rel="noreferrer" className="group block p-5">
        <div className="flex items-center justify-between">
          <span className="font-display font-semibold text-ink">{app.name}</span>
          <span className="inline-flex items-center gap-2">
            <span className={`h-2.5 w-2.5 rounded-full ${app.status === 'active' ? 'bg-emerald-500' : 'bg-amber-400'}`} />
            <OpenIcon />
          </span>
        </div>
        <div className="mt-3 flex items-center gap-4 text-sm">
          <span className="text-ink"><span className="font-display font-semibold">{stat?.tenants ?? 0}</span> <span className="text-ink-mute">tenants</span></span>
          <span className="h-3 w-px bg-hair" />
          <span className="text-ink"><span className="font-display font-semibold">{stat?.active ?? 0}</span><span className="text-ink-faint">/{stat?.licenses ?? 0}</span> <span className="text-ink-mute">licencias</span></span>
        </div>
        <div className="mt-2 text-xs text-ink-faint">{BACKEND_LABEL[app.backend] ?? app.backend}</div>
      </a>
      <div className="px-5 py-2.5 border-t border-hair">
        <Link to={`/apps/${app.id}`} className="inline-flex items-center gap-1 text-xs font-medium text-brand hover:text-brand-deep">
          Ver detalle <span aria-hidden="true">→</span>
        </Link>
      </div>
    </div>
  )
}

// Freeware/site: a launch tile — one job, opens the real thing.
function LaunchTile({ app }) {
  return (
    <a href={app.url} target="_blank" rel="noreferrer"
      className="group flex items-center justify-between gap-2 rounded-lg border border-hair bg-paper-card px-4 py-3 hover:border-brand/40 hover:bg-white transition">
      <span className="text-sm font-medium text-ink truncate">{app.name}</span>
      <OpenIcon />
    </a>
  )
}

export function Dashboard() {
  const [apps, setApps] = useState([])
  const [stats, setStats] = useState({})
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
    })
  }, [])

  const byCat = useMemo(() => {
    const m = { app: [], freeware: [], site: [] }
    for (const a of apps) (m[a.category] ??= []).push(a)
    return m
  }, [apps])

  const totals = useMemo(() => {
    const tenants = Object.values(stats).reduce((n, x) => n + x.tenants, 0)
    const active = Object.values(stats).reduce((n, x) => n + x.active, 0)
    return { products: apps.length, saas: byCat.app.length, tenants, active }
  }, [apps, stats, byCat])

  return (
    <div>
      <PageHeader title="Portafolio" subtitle="Todo lo que opera ACACIA — un clic abre cada cosa." />

      {error && <p className="mb-4 text-sm text-red-600">No se pudo leer el registro: {error}</p>}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Productos" value={totals.products} accent hint="en el portafolio" />
        <StatCard label="Apps SaaS" value={totals.saas} hint="con backend operable" />
        <StatCard label="Tenants" value={totals.tenants} hint="clientes sincronizados" />
        <StatCard label="Licencias activas" value={totals.active} hint="al día de hoy" />
      </div>

      {SECTIONS.map(({ key, label, sub }) => {
        const items = byCat[key] ?? []
        if (items.length === 0) return null
        return (
          <section key={key} className="mt-9">
            <div className="mb-3 flex items-baseline justify-between border-b border-hair pb-2">
              <div className="flex items-baseline gap-3">
                <h2 className="font-display text-sm font-semibold uppercase tracking-[0.14em] text-ink">{label}</h2>
                <span className="text-xs text-ink-faint">{sub}</span>
              </div>
              <span className="text-xs text-ink-mute">{items.length}</span>
            </div>

            {key === 'app' ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {items.map((a) => <AppCard key={a.id} app={a} stat={stats[a.id]} />)}
              </div>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
                {items.map((a) => <LaunchTile key={a.id} app={a} />)}
              </div>
            )}
          </section>
        )
      })}

      {apps.length === 0 && !error && (
        <p className="mt-6 text-sm text-ink-soft">El registro está vacío. Aplica los seeds.</p>
      )}
    </div>
  )
}
