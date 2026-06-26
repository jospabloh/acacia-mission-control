import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase.js'
import { PageHeader, StatCard } from '../components/PageHeader.jsx'

const money = (cents, cur = 'MXN') =>
  new Intl.NumberFormat('es-MX', { style: 'currency', currency: cur || 'MXN', maximumFractionDigits: 0 }).format((cents ?? 0) / 100)

function Bars({ title, rows, total }) {
  return (
    <div className="rounded-xl border border-hair bg-paper-card p-5">
      <h3 className="font-display text-sm font-semibold uppercase tracking-wide text-ink-mute">{title}</h3>
      <div className="mt-4 space-y-3">
        {rows.length === 0 && <p className="text-sm text-ink-faint">Sin datos.</p>}
        {rows.map(({ key, cents }) => (
          <div key={key}>
            <div className="flex items-center justify-between text-sm">
              <span className="text-ink">{key}</span>
              <span className="text-ink-mute"><span className="font-display font-semibold text-ink">{money(cents)}</span> · {total ? Math.round((cents / total) * 100) : 0}%</span>
            </div>
            <div className="mt-1 h-2 rounded-full bg-paper-subtle overflow-hidden">
              <div className="h-full rounded-full bg-brand" style={{ width: `${total ? (cents / total) * 100 : 0}%` }} />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

export function Revenue() {
  const [rows, setRows] = useState(null)

  useEffect(() => {
    supabase.from('revenue_events')
      .select('id, app_id, event_type, amount_cents, currency, occurred_at, apps(name)')
      .order('occurred_at', { ascending: false })
      .limit(500)
      .then(({ data, error }) => { if (error) console.error(error.message); setRows(data ?? []) })
  }, [])

  const sum = useMemo(() => {
    const r = rows ?? []
    const now = new Date()
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime()
    let total = 0, month = 0
    const byApp = {}, byType = {}
    for (const e of r) {
      const c = e.amount_cents ?? 0
      total += c
      if (new Date(e.occurred_at).getTime() >= monthStart) month += c
      const an = e.apps?.name ?? e.app_id ?? '—'
      byApp[an] = (byApp[an] ?? 0) + c
      byType[e.event_type ?? '—'] = (byType[e.event_type ?? '—'] ?? 0) + c
    }
    const toRows = (o) => Object.entries(o).map(([key, cents]) => ({ key, cents })).sort((a, b) => b.cents - a.cents)
    const count = r.length
    return { total, month, count, avg: count ? Math.round(total / count) : 0, byApp: toRows(byApp), byType: toRows(byType) }
  }, [rows])

  if (rows === null) return (<div><PageHeader title="Ingresos" /><p className="text-sm text-ink-mute">Cargando…</p></div>)

  return (
    <div>
      <PageHeader title="Ingresos" subtitle="Pagos y renovaciones vía Mercado Pago — del webhook a la bodega." />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Este mes" value={money(sum.month)} accent hint="ingresos del mes en curso" />
        <StatCard label="Acumulado" value={money(sum.total)} hint={`${sum.count} pagos`} />
        <StatCard label="Ticket promedio" value={money(sum.avg)} />
        <StatCard label="Pagos" value={sum.count} hint="eventos registrados" />
      </div>

      <div className="mt-6 grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Bars title="Ingresos por app" rows={sum.byApp} total={sum.total} />
        <Bars title="Ingresos por tipo" rows={sum.byType} total={sum.total} />
      </div>

      <div className="mt-6 rounded-xl border border-hair bg-paper-card overflow-hidden">
        <h3 className="px-5 pt-5 font-display text-sm font-semibold uppercase tracking-wide text-ink-mute">Movimientos recientes</h3>
        <table className="mt-3 w-full text-sm">
          <thead className="text-left text-xs uppercase tracking-wide text-ink-mute border-b border-hair">
            <tr><th className="px-5 py-2">Fecha</th><th className="px-5 py-2">App</th><th className="px-5 py-2">Tipo</th><th className="px-5 py-2 text-right">Monto</th></tr>
          </thead>
          <tbody>
            {(rows ?? []).slice(0, 25).map((r) => (
              <tr key={r.id} className="border-b border-hair last:border-0">
                <td className="px-5 py-3 text-ink-soft">{new Date(r.occurred_at).toLocaleDateString('es-MX')}</td>
                <td className="px-5 py-3 font-medium text-ink">{r.apps?.name ?? r.app_id ?? '—'}</td>
                <td className="px-5 py-3 text-ink-soft">{r.event_type}</td>
                <td className="px-5 py-3 text-right font-medium text-ink">{money(r.amount_cents, r.currency)}</td>
              </tr>
            ))}
            {sum.count === 0 && (
              <tr><td colSpan={4} className="px-5 py-4 text-ink-faint">Aún sin pagos. Cuando Mercado Pago confirme una renovación, el webhook la registra aquí y los KPIs se llenan solos.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
