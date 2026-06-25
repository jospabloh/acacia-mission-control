import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase.js'
import { PageHeader, EmptyState } from '../components/PageHeader.jsx'

export function Revenue() {
  const [rows, setRows] = useState(null)

  useEffect(() => {
    supabase.from('revenue_events')
      .select('id, event_type, amount_cents, currency, occurred_at, apps(name)')
      .order('occurred_at', { ascending: false })
      .limit(100)
      .then(({ data, error }) => { if (error) console.error(error.message); setRows(data ?? []) })
  }, [])

  const money = (cents, cur) =>
    new Intl.NumberFormat('es-MX', { style: 'currency', currency: cur || 'MXN' }).format((cents ?? 0) / 100)

  return (
    <div>
      <PageHeader title="Ingresos" subtitle="Pagos y renovaciones vía Mercado Pago." />
      {rows === null ? (
        <p className="text-sm text-ink-mute">Cargando…</p>
      ) : rows.length === 0 ? (
        <EmptyState icon="revenue" title="Sin eventos de ingreso todavía" phase={1}>
          El webhook de <code className="font-mono text-ink">Mercado Pago</code> registrará pagos y
          renovaciones aquí, y de eso saldrá el MRR, las renovaciones y el churn.
        </EmptyState>
      ) : (
        <div className="overflow-hidden rounded-xl border border-hair bg-paper-card">
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase tracking-wide text-ink-mute border-b border-hair">
              <tr><th className="px-4 py-3">Fecha</th><th className="px-4 py-3">App</th><th className="px-4 py-3">Tipo</th><th className="px-4 py-3 text-right">Monto</th></tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-b border-hair last:border-0">
                  <td className="px-4 py-3 text-ink-soft">{new Date(r.occurred_at).toLocaleDateString('es-MX')}</td>
                  <td className="px-4 py-3 font-medium text-ink">{r.apps?.name ?? '—'}</td>
                  <td className="px-4 py-3 text-ink-soft">{r.event_type}</td>
                  <td className="px-4 py-3 text-right font-medium text-ink">{money(r.amount_cents, r.currency)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
