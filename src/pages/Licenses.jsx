import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase.js'
import { PageHeader, EmptyState } from '../components/PageHeader.jsx'

const STATUS_STYLE = {
  active: 'bg-emerald-50 text-emerald-700',
  trial: 'bg-blue-50 text-blue-700',
  past_due: 'bg-amber-50 text-amber-700',
  canceled: 'bg-red-50 text-red-700',
}

export function Licenses() {
  const [rows, setRows] = useState(null) // null = loading

  useEffect(() => {
    supabase.from('licenses')
      .select('id, plan, status, seats, current_period_end, apps(name)')
      .order('synced_at', { ascending: false })
      .then(({ data, error }) => { if (error) console.error(error.message); setRows(data ?? []) })
  }, [])

  return (
    <div>
      <PageHeader title="Licencias" subtitle="Estado de licencias por tenant y app." />
      {rows === null ? (
        <p className="text-sm text-ink-mute">Cargando…</p>
      ) : rows.length === 0 ? (
        <EmptyState icon="license" title="Aún no hay licencias sincronizadas" phase={1}>
          El cron <code className="font-mono text-ink">sync-licenses</code> leerá las licencias de cada
          app (Puntos+, Rumbo, LIUMA, FlowFin, StockFlow) y las mostrará aquí.
        </EmptyState>
      ) : (
        <div className="overflow-hidden rounded-xl border border-hair bg-paper-card">
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase tracking-wide text-ink-mute border-b border-hair">
              <tr><th className="px-4 py-3">App</th><th className="px-4 py-3">Plan</th><th className="px-4 py-3">Estado</th><th className="px-4 py-3">Asientos</th><th className="px-4 py-3">Renueva</th></tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-b border-hair last:border-0">
                  <td className="px-4 py-3 font-medium text-ink">{r.apps?.name ?? '—'}</td>
                  <td className="px-4 py-3 text-ink-soft">{r.plan ?? '—'}</td>
                  <td className="px-4 py-3"><span className={`rounded-md px-2 py-0.5 text-xs font-medium ${STATUS_STYLE[r.status] ?? 'bg-paper-subtle text-ink-mute'}`}>{r.status ?? '—'}</span></td>
                  <td className="px-4 py-3 text-ink-soft">{r.seats ?? '—'}</td>
                  <td className="px-4 py-3 text-ink-soft">{r.current_period_end ? new Date(r.current_period_end).toLocaleDateString('es-MX') : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
