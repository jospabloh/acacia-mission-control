import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase.js'
import { fetchApps } from '../lib/appRegistry.js'
import { summarizePortfolio } from '../lib/insights.js'
import { PageHeader, StatCard } from '../components/PageHeader.jsx'

const STATUS_LABEL = { active: 'Activas', trial: 'En prueba', view_only: 'Solo lectura', past_due: 'Vencidas', canceled: 'Canceladas', desconocido: 'Sin estado' }
const STATUS_BAR = { active: 'bg-emerald-500', trial: 'bg-brand', view_only: 'bg-amber-400', past_due: 'bg-red-400', canceled: 'bg-ink-faint', desconocido: 'bg-ink-faint' }

function Bars({ title, rows, total, colorFor }) {
  return (
    <div className="rounded-xl border border-hair bg-paper-card p-5">
      <h3 className="font-display text-sm font-semibold uppercase tracking-wide text-ink-mute">{title}</h3>
      <div className="mt-4 space-y-3">
        {rows.length === 0 && <p className="text-sm text-ink-faint">Sin datos.</p>}
        {rows.map(({ key, count }) => (
          <div key={key}>
            <div className="flex items-center justify-between text-sm">
              <span className="text-ink">{STATUS_LABEL[key] ?? key}</span>
              <span className="text-ink-mute"><span className="font-display font-semibold text-ink">{count}</span> · {Math.round((count / total) * 100)}%</span>
            </div>
            <div className="mt-1 h-2 rounded-full bg-paper-subtle overflow-hidden">
              <div className={`h-full rounded-full ${colorFor?.(key) ?? 'bg-brand'}`} style={{ width: `${(count / total) * 100}%` }} />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

export function Analytics() {
  const [data, setData] = useState(null)
  const [usage, setUsage] = useState(null) // { day, byApp: {app_id: {name, metrics:[{metric,value}]}} }
  const [error, setError] = useState(null)

  useEffect(() => {
    Promise.all([
      fetchApps(),
      supabase.from('licenses').select('app_id, status, plan, seats, trial_ends_at, current_period_end'),
      supabase.from('tenants').select('app_id'),
    ]).then(([apps, l, t]) => {
      if (l.error) throw l.error
      const appName = Object.fromEntries(apps.map((a) => [a.id, a.name]))
      setData(summarizePortfolio({ apps, licenses: l.data ?? [], tenants: t.data ?? [] }))

      // Product usage: latest day's snapshot from usage_daily.
      supabase.from('usage_daily').select('app_id, metric, value, day').is('tenant_id', null)
        .order('day', { ascending: false }).limit(500)
        .then(({ data: u }) => {
          if (!u?.length) { setUsage({ day: null, byApp: {} }); return }
          const day = u[0].day
          const byApp = {}
          for (const r of u.filter((x) => x.day === day)) {
            (byApp[r.app_id] ??= { name: appName[r.app_id] ?? r.app_id, metrics: [] }).metrics.push({ metric: r.metric, value: r.value })
          }
          setUsage({ day, byApp })
        })
    }).catch((e) => setError(e.message))
  }, [])

  const maxTenants = useMemo(() => Math.max(1, ...(data?.byApp ?? []).map((a) => a.tenants)), [data])

  if (error) return (<div><PageHeader title="Analítica" /><p className="text-sm text-red-600">No se pudo leer: {error}</p></div>)
  if (!data) return (<div><PageHeader title="Analítica" /><p className="text-sm text-ink-mute">Cargando…</p></div>)

  const t = data.totals
  return (
    <div>
      <PageHeader title="Analítica" subtitle="Uso y consumo del portafolio — licencias y tenants en vivo." />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Licencias" value={t.licenses} hint={`${t.tenants} tenants`} />
        <StatCard label="Activas" value={t.active} accent hint={`${t.activeRate}% del total`} />
        <StatCard label="En prueba" value={t.trial} hint={`${data.trialsEnding14} por vencer ≤14d`} />
        <StatCard label="Asientos" value={t.seats} hint={`${data.renewals30} renovaciones ≤30d`} />
      </div>

      <div className="mt-6 grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Bars title="Licencias por estado" rows={data.byStatus} total={t.licenses} colorFor={(k) => STATUS_BAR[k] ?? 'bg-brand'} />
        <Bars title="Licencias por plan" rows={data.byPlan} total={t.licenses} />
      </div>

      <div className="mt-6 rounded-xl border border-hair bg-paper-card p-5">
        <h3 className="font-display text-sm font-semibold uppercase tracking-wide text-ink-mute">Vencimientos próximos</h3>
        <p className="mt-1 text-xs text-ink-faint">Renovaciones y fines de prueba en los próximos 45 días.</p>
        <div className="mt-4 space-y-2">
          {data.upcoming.length === 0 && <p className="text-sm text-ink-faint">Nada por vencer pronto. 🎉</p>}
          {data.upcoming.slice(0, 8).map((u, i) => (
            <div key={i} className="flex items-center justify-between gap-3 text-sm">
              <span className="flex items-center gap-2 min-w-0">
                <span className={`h-1.5 w-1.5 rounded-full ${u.type === 'fin de prueba' ? 'bg-amber-400' : 'bg-brand'}`} />
                <span className="font-medium text-ink truncate">{u.name}</span>
                <span className="text-ink-mute">· {u.type}</span>
              </span>
              <span className={`shrink-0 rounded-md px-2 py-0.5 text-xs font-medium ${u.in_days <= 7 ? 'bg-red-50 text-red-700' : 'bg-paper-subtle text-ink-mute'}`}>
                {u.in_days === 0 ? 'hoy' : `en ${u.in_days}d`}
              </span>
            </div>
          ))}
        </div>
      </div>

      <div className="mt-6 rounded-xl border border-hair bg-paper-card overflow-hidden">
        <h3 className="px-5 pt-5 font-display text-sm font-semibold uppercase tracking-wide text-ink-mute">Uso por app</h3>
        <table className="mt-3 w-full text-sm">
          <thead className="text-left text-xs uppercase tracking-wide text-ink-mute border-b border-hair">
            <tr><th className="px-5 py-2">App</th><th className="px-5 py-2">Tenants</th><th className="px-5 py-2">Activas / Total</th><th className="px-5 py-2 w-1/3">Distribución</th></tr>
          </thead>
          <tbody>
            {data.byApp.map((a) => (
              <tr key={a.app_id} className="border-b border-hair last:border-0">
                <td className="px-5 py-3 font-medium text-ink">{a.name}</td>
                <td className="px-5 py-3 text-ink-soft">{a.tenants}</td>
                <td className="px-5 py-3 text-ink-soft"><span className="font-display font-semibold text-ink">{a.active}</span> / {a.licenses}</td>
                <td className="px-5 py-3">
                  <div className="h-2 rounded-full bg-paper-subtle overflow-hidden">
                    <div className="h-full rounded-full bg-brand" style={{ width: `${(a.tenants / maxTenants) * 100}%` }} />
                  </div>
                </td>
              </tr>
            ))}
            {data.byApp.length === 0 && <tr><td colSpan={4} className="px-5 py-4 text-ink-faint">Aún no hay datos sincronizados.</td></tr>}
          </tbody>
        </table>
      </div>

      <div className="mt-6 rounded-xl border border-hair bg-paper-card p-5">
        <div className="flex items-baseline justify-between">
          <h3 className="font-display text-sm font-semibold uppercase tracking-wide text-ink-mute">Uso de producto</h3>
          {usage?.day && <span className="text-xs text-ink-faint">snapshot {usage.day}</span>}
        </div>
        {usage && Object.keys(usage.byApp).length > 0 ? (
          <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-4">
            {Object.entries(usage.byApp).map(([id, a]) => (
              <div key={id} className="rounded-lg border border-hair p-4">
                <div className="font-medium text-ink">{a.name}</div>
                <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1.5">
                  {a.metrics.map((m) => (
                    <span key={m.metric} className="text-sm">
                      <span className="font-display font-semibold text-ink">{m.value.toLocaleString('es-MX')}</span>
                      <span className="ml-1 text-ink-mute">{m.metric}</span>
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="mt-3 text-sm text-ink-faint">
            Sin snapshot aún. Corre el cron <code className="font-mono text-ink">sync-usage</code> (necesita
            la función <code className="font-mono text-ink">acaciaControl</code> con <code className="font-mono text-ink">usage.summary</code> desplegada en cada app).
          </p>
        )}
      </div>

      <p className="mt-6 text-xs text-ink-faint">
        Próximas capas: tráfico web (PostHog), costos de infraestructura por app.
      </p>
    </div>
  )
}
