import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase.js'
import { fetchApps } from '../lib/appRegistry.js'
import { PageHeader, StatCard } from '../components/PageHeader.jsx'
import { Icon } from '../components/icons.jsx'

const BACKEND_LABEL = { base44: 'Base44', supabase: 'Supabase', external: 'Externo', static: 'Estático' }

async function countOf(table, filter) {
  let q = supabase.from(table).select('*', { count: 'exact', head: true })
  if (filter) q = filter(q)
  const { count, error } = await q
  if (error) { console.error(`[dashboard] count ${table}`, error.message); return 0 }
  return count ?? 0
}

export function Dashboard() {
  const [apps, setApps] = useState([])
  const [stats, setStats] = useState({ tenants: 0, licenses: 0 })
  const [error, setError] = useState(null)

  useEffect(() => {
    fetchApps().then(setApps).catch((e) => setError(e.message))
    Promise.all([
      countOf('tenants'),
      countOf('licenses', (q) => q.eq('status', 'active')),
    ]).then(([tenants, licenses]) => setStats({ tenants, licenses }))
  }, [])

  return (
    <div>
      <PageHeader title="Portafolio" subtitle="Vista general de las apps de ACACIA y su estado." />

      {error && <p className="mb-4 text-sm text-red-600">No se pudo leer el registro: {error}</p>}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Apps" value={apps.length} accent hint="en el registro" />
        <StatCard label="Tenants" value={stats.tenants} hint="clientes sincronizados" />
        <StatCard label="Licencias activas" value={stats.licenses} hint="al día de hoy" />
        <StatCard label="MRR" value="—" hint="se calcula en Fase 1" />
      </div>

      <div className="mt-8 mb-3 flex items-center justify-between">
        <h2 className="font-display text-sm font-semibold uppercase tracking-wide text-ink-mute">Apps</h2>
        <span className="text-xs text-ink-faint">{apps.length} sistemas</span>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {apps.map((a) => (
          <Link key={a.id} to={`/apps/${a.id}`}
            className="group block rounded-xl border border-hair bg-paper-card p-5 hover:border-brand/40 hover:shadow-card transition">
            <div className="flex items-center justify-between">
              <span className="font-display font-semibold text-ink">{a.name}</span>
              <span className={`h-2.5 w-2.5 rounded-full ${a.status === 'active' ? 'bg-emerald-500' : 'bg-amber-400'}`} />
            </div>
            <div className="mt-3 flex items-center gap-2 text-xs text-ink-mute">
              <span className="rounded-md bg-paper-subtle px-2 py-0.5 font-medium">{BACKEND_LABEL[a.backend] ?? a.backend}</span>
              {a.external_id && <span className="font-mono text-ink-faint">{a.external_id.slice(0, 8)}…</span>}
            </div>
            <div className="mt-3 flex items-center gap-1 text-xs font-medium text-brand opacity-0 group-hover:opacity-100 transition">
              Abrir <Icon name="external" size={13} />
            </div>
          </Link>
        ))}
      </div>

      {apps.length === 0 && !error && (
        <p className="text-sm text-ink-soft">El registro de apps está vacío. Aplica el seed 0002.</p>
      )}
    </div>
  )
}
