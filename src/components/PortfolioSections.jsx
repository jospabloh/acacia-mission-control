import { Link } from 'react-router-dom'
import { Icon } from './icons.jsx'
import { SECTIONS } from '../lib/usePortfolioData.js'

function fmt(n) { return typeof n === 'number' ? n.toLocaleString('es-MX') : '—' }

const BACKEND_LABEL = { base44: 'Base44', supabase: 'Supabase', external: 'Externo', static: 'Estático' }

// SaaS app: a control panel door — live status + synced stats. The whole card
// opens the in-app control + analytics view (NOT the live app). A tiny "abrir ↗"
// is the only escape hatch to the running app.
function AppCard({ app, stat, sess }) {
  return (
    <div className="group relative rounded-xl border border-hair bg-paper-card hover:border-brand/40 hover:shadow-card transition">
      <a href={app.url} target="_blank" rel="noreferrer" title="Abrir la app"
        onClick={(e) => e.stopPropagation()}
        className="absolute right-4 top-4 z-10 text-ink-faint hover:text-brand">
        <Icon name="external" size={14} />
      </a>
      <Link to={`/apps/${app.id}`} className="block p-5">
        <div className="flex items-center gap-2 pr-6">
          <span className={`h-2.5 w-2.5 rounded-full ${app.status === 'active' ? 'bg-emerald-500' : 'bg-amber-400'}`} />
          <span className="font-display font-semibold text-ink">{app.name}</span>
        </div>
        <div className="mt-3 flex items-center gap-4 text-sm">
          <span className="text-ink"><span className="font-display font-semibold">{stat?.tenants ?? 0}</span> <span className="text-ink-mute">tenants</span></span>
          <span className="h-3 w-px bg-hair" />
          <span className="text-ink"><span className="font-display font-semibold">{stat?.active ?? 0}</span><span className="text-ink-faint">/{stat?.licenses ?? 0}</span> <span className="text-ink-mute">licencias</span></span>
        </div>
        {sess && (
          <div className="mt-3 flex items-center gap-2 border-t border-dashed border-hair pt-2.5 text-sm">
            <span className={`h-2 w-2 rounded-full ${sess.online > 0 ? 'bg-emerald-500' : sess.open > 0 ? 'bg-amber-400' : 'bg-ink-faint'}`} />
            {sess.open > 0 ? (
              <>
                <span className="text-ink"><span className="font-display font-semibold">{sess.open}</span> <span className="text-ink-mute">{sess.open === 1 ? 'sesión' : 'sesiones'}</span></span>
                {sess.online > 0
                  ? <span className="text-xs font-medium text-emerald-600 dark:text-emerald-400">· {sess.online} en línea</span>
                  : <span className="text-xs text-ink-mute">· todas idle</span>}
              </>
            ) : (
              <span className="text-xs text-ink-faint">sin sesiones abiertas</span>
            )}
          </div>
        )}
        <div className="mt-2 text-xs text-ink-faint">{BACKEND_LABEL[app.backend] ?? app.backend}</div>
        <div className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-brand group-hover:text-brand-deep">
          Control y analíticas <span aria-hidden="true" className="transition-transform group-hover:translate-x-0.5">→</span>
        </div>
      </Link>
    </div>
  )
}

// Freeware/sites: data-first, not a launcher. A compact table built for KPIs
// (traffic, usage) with just a small ↗ to open. KPI columns stay "—" until a
// web-analytics source is connected.
function CatalogTable({ items, byApp }) {
  return (
    <div className="overflow-hidden rounded-xl border border-hair bg-paper-card">
      <table className="w-full text-sm">
        <thead className="text-left text-xs uppercase tracking-wide text-ink-mute border-b border-hair">
          <tr>
            <th className="px-4 py-2.5">Nombre</th>
            <th className="px-4 py-2.5">Visitas 30d</th>
            <th className="px-4 py-2.5">Usuarios</th>
            <th className="px-4 py-2.5">Últimos 7d</th>
            <th className="px-4 py-2.5 text-right">Abrir</th>
          </tr>
        </thead>
        <tbody>
          {items.map((a) => {
            const k = byApp?.[a.id]
            return (
              <tr key={a.id} className="border-b border-hair last:border-0">
                <td className="px-4 py-2.5 font-medium text-ink">{a.name}</td>
                <td className="px-4 py-2.5 text-ink-soft">{k ? <span className="font-display font-semibold text-ink">{fmt(k.visits30)}</span> : <span className="text-ink-faint">—</span>}</td>
                <td className="px-4 py-2.5 text-ink-soft">{k ? fmt(k.visitors30) : <span className="text-ink-faint">—</span>}</td>
                <td className="px-4 py-2.5 text-ink-soft">{k ? fmt(k.visits7) : <span className="text-ink-faint">—</span>}</td>
                <td className="px-4 py-2.5 text-right">
                  <a href={a.url} target="_blank" rel="noreferrer" title="Abrir"
                    className="inline-flex text-ink-faint hover:text-brand">
                    <Icon name="external" size={14} />
                  </a>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

// Renders the SaaS/Freeware/Sitios sections. Pass `onlyCategory` to show a
// single section (e.g. the "Apps SaaS" stat card's dedicated view).
export function PortfolioSections({ byCat, stats, sessByApp, byApp, hasKpis, onlyCategory }) {
  const sections = onlyCategory ? SECTIONS.filter((s) => s.key === onlyCategory) : SECTIONS
  return (
    <>
      {sections.map(({ key, label, sub }) => {
        const items = byCat[key] ?? []
        if (items.length === 0) return null
        return (
          <section key={key} className="mt-9 first:mt-0">
            <div className="mb-3 flex items-baseline justify-between border-b border-hair pb-2">
              <div className="flex items-baseline gap-3">
                <h2 className="font-display text-sm font-semibold uppercase tracking-[0.14em] text-ink">{label}</h2>
                <span className="text-xs text-ink-faint">{sub}</span>
              </div>
              <span className="text-xs text-ink-mute">{items.length}</span>
            </div>

            {key === 'app' ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {items.map((a) => <AppCard key={a.id} app={a} stat={stats[a.id]} sess={sessByApp[a.id]} />)}
              </div>
            ) : (
              <>
                {!hasKpis && <p className="mb-2 text-xs text-ink-faint">Tráfico midiéndose — los KPIs aparecen conforme llegan visitas (analítica propia).</p>}
                <CatalogTable items={items} byApp={byApp} />
              </>
            )}
          </section>
        )
      })}
    </>
  )
}
