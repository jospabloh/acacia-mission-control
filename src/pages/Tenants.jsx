import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase.js'
import { PageHeader, EmptyState } from '../components/PageHeader.jsx'

const STATUS_STYLE = {
  active: 'bg-emerald-50 text-emerald-700',
  trial: 'bg-blue-50 text-blue-700',
  view_only: 'bg-amber-50 text-amber-700',
  past_due: 'bg-amber-50 text-amber-700',
  suspended: 'bg-red-50 text-red-700',
  canceled: 'bg-red-50 text-red-700',
  cancelled: 'bg-red-50 text-red-700',
}

// Portfolio-wide tenant roster (all apps). Read-only — tenant actions
// (suspend/reactivate/plan changes) happen per-license on /licenses.
export function Tenants() {
  const [rows, setRows] = useState(null) // null = loading

  useEffect(() => {
    supabase.from('tenants').select('id, external_id, name, status, plan, app_id, apps(id, name)')
      .order('name')
      .then(({ data, error }) => { if (error) console.error(error.message); setRows(data ?? []) })
  }, [])

  return (
    <div>
      <PageHeader title="Tenants" subtitle="Clientes sincronizados de todas las apps del portafolio." />

      {rows === null ? (
        <p className="text-sm text-ink-mute">Cargando…</p>
      ) : rows.length === 0 ? (
        <EmptyState icon="crm" title="Aún no hay tenants sincronizados">
          El cron <code className="font-mono text-ink">sync</code> leerá los tenants de cada app y los mostrará aquí.
        </EmptyState>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-hair bg-paper-card">
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase tracking-wide text-ink-mute border-b border-hair">
              <tr>
                <th className="px-4 py-3">Tenant</th><th className="px-4 py-3">App</th>
                <th className="px-4 py-3">Plan</th><th className="px-4 py-3">Estado</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-b border-hair last:border-0">
                  <td className="px-4 py-3 font-medium text-ink">{r.name ?? r.external_id}</td>
                  <td className="px-4 py-3 text-ink-soft">
                    {r.apps?.id ? <Link to={`/apps/${r.apps.id}`} className="hover:text-brand">{r.apps.name}</Link> : (r.apps?.name ?? r.app_id)}
                  </td>
                  <td className="px-4 py-3 text-ink-soft">{r.plan ?? '—'}</td>
                  <td className="px-4 py-3"><span className={`rounded-md px-2 py-0.5 text-xs font-medium ${STATUS_STYLE[r.status] ?? 'bg-paper-subtle text-ink-mute'}`}>{r.status ?? '—'}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
