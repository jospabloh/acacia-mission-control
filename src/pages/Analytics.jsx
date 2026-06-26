import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase.js'
import { fetchApps } from '../lib/appRegistry.js'
import { summarizePortfolio } from '../lib/insights.js'
import { webKpis, usageByTenant } from '../lib/control.js'
import { PageHeader, StatCard } from '../components/PageHeader.jsx'

const STATUS_LABEL = { active: 'Activas', trial: 'En prueba', view_only: 'Solo lectura', past_due: 'Vencidas', canceled: 'Canceladas', desconocido: 'Sin estado' }
const STATUS_BAR = { active: 'bg-emerald-500', trial: 'bg-brand', view_only: 'bg-amber-400', past_due: 'bg-red-400', canceled: 'bg-ink-faint', desconocido: 'bg-ink-faint' }
const fmt = (n) => (typeof n === 'number' ? n.toLocaleString('es-MX') : '—')

// Dependency-free inline sparkline.
function Sparkline({ values, w = 116, h = 28, color = '#3b6ef8' }) {
  const pts = (values ?? []).filter((v) => typeof v === 'number')
  if (pts.length < 2) return <span className="text-[11px] text-ink-faint">faltan días</span>
  const max = Math.max(...pts), min = Math.min(...pts), range = max - min || 1
  const step = w / (pts.length - 1)
  const d = pts.map((v, i) => `${i ? 'L' : 'M'}${(i * step).toFixed(1)},${(h - 2 - ((v - min) / range) * (h - 4)).toFixed(1)}`).join(' ')
  return (
    <svg width={w} height={h} className="overflow-visible" aria-hidden="true">
      <path d={d} fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  )
}

function Delta({ values }) {
  const pts = (values ?? []).filter((v) => typeof v === 'number')
  if (pts.length < 2) return null
  const d = pts[pts.length - 1] - pts[pts.length - 2]
  if (d === 0) return <span className="text-[11px] text-ink-faint">=</span>
  const up = d > 0
  return <span className={`text-[11px] font-medium ${up ? 'text-emerald-600' : 'text-red-500'}`}>{up ? '▲' : '▼'} {fmt(Math.abs(d))}</span>
}

const USAGE_APPS = [
  { id: 'flowfin', name: 'FlowFin' }, { id: 'stockflow', name: 'StockFlow' },
  { id: 'puntos', name: 'Puntos+' }, { id: 'rumbo', name: 'Rumbo' }, { id: 'liuma', name: 'LIUMA' },
]

// Per-tenant consumption — which tenants use the app most (counts only).
function TenantConsumption() {
  const [appId, setAppId] = useState('flowfin')
  const [res, setRes] = useState(null)
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState(null)
  useEffect(() => {
    setLoading(true); setErr(null); setRes(null)
    usageByTenant(appId).then(setRes).catch((e) => setErr(e.message)).finally(() => setLoading(false))
  }, [appId])
  const top = res?.top ?? []
  const max = Math.max(1, ...top.map((r) => r.count))
  return (
    <div className="mt-6 rounded-xl border border-hair bg-paper-card p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="font-display text-sm font-semibold uppercase tracking-wide text-ink-mute">Consumo por tenant</h3>
        <select value={appId} onChange={(e) => setAppId(e.target.value)}
          className="rounded-lg border border-hair bg-white px-3 py-1.5 text-sm">
          {USAGE_APPS.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>
      </div>
      <p className="mt-1 text-xs text-ink-faint">Tenants con más {res?.label ?? 'actividad'} — para upsell o soporte proactivo. Solo conteos, sin datos personales.</p>
      {loading ? <p className="mt-3 text-sm text-ink-mute">Cargando…</p>
        : err ? <p className="mt-3 text-sm text-red-600">No se pudo leer: {err}</p>
        : top.length ? (
          <div className="mt-4 space-y-2.5">
            {top.slice(0, 10).map((r, i) => (
              <div key={r.id}>
                <div className="flex items-center justify-between text-sm">
                  <span className="flex items-center gap-2 min-w-0">
                    <span className="text-ink-faint w-4 text-right">{i + 1}</span>
                    <span className="font-medium text-ink truncate">{r.name ?? <span className="font-mono text-ink-mute">{r.id}</span>}</span>
                  </span>
                  <span className="text-ink-mute"><span className="font-display font-semibold text-ink">{fmt(r.count)}</span> {res.label}</span>
                </div>
                <div className="mt-1 h-2 rounded-full bg-paper-subtle overflow-hidden">
                  <div className="h-full rounded-full bg-brand" style={{ width: `${(r.count / max) * 100}%` }} />
                </div>
              </div>
            ))}
          </div>
        ) : <p className="mt-3 text-sm text-ink-faint">Sin datos para esta app. (Requiere el puente con <code className="font-mono text-ink">usage.byTenant</code> desplegado.)</p>}
    </div>
  )
}

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

// Build latest snapshot + per-app/metric daily series from usage_daily rows.
function buildUsage(rows, appName) {
  if (!rows.length) return { day: null, byApp: {}, series: {}, days: 0 }
  const dayset = [...new Set(rows.map((r) => r.day))].sort()
  const day = dayset[dayset.length - 1]
  const byApp = {}, series = {}
  for (const r of rows) {
    if (r.day === day) (byApp[r.app_id] ??= { name: appName[r.app_id] ?? r.app_id, metrics: [] }).metrics.push({ metric: r.metric, value: r.value })
    const s = (series[r.app_id] ??= {})
    ;(s[r.metric] ??= []).push({ day: r.day, value: r.value })
  }
  for (const app of Object.values(series)) for (const k in app) app[k].sort((a, b) => a.day.localeCompare(b.day))
  return { day, byApp, series, days: dayset.length }
}

export function Analytics() {
  const [data, setData] = useState(null)
  const [usage, setUsage] = useState(null)
  const [web, setWeb] = useState(null)
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

      supabase.from('usage_daily').select('app_id, metric, value, day').is('tenant_id', null)
        .order('day', { ascending: true }).limit(3000)
        .then(({ data: u }) => setUsage(buildUsage(u ?? [], appName)))
    }).catch((e) => setError(e.message))

    webKpis().then(setWeb).catch(() => setWeb({ totals: { visits30: 0, visitors30: 0 }, top: [], series: [] }))
  }, [])

  const maxTenants = useMemo(() => Math.max(1, ...(data?.byApp ?? []).map((a) => a.tenants)), [data])

  if (error) return (<div><PageHeader title="Analítica" /><p className="text-sm text-red-600">No se pudo leer: {error}</p></div>)
  if (!data) return (<div><PageHeader title="Analítica" /><p className="text-sm text-ink-mute">Cargando…</p></div>)

  const t = data.totals
  return (
    <div>
      <PageHeader title="Analítica" subtitle="Uso, consumo y tráfico del portafolio — tendencias en vivo." />

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

      {/* Tendencia de uso de producto */}
      <div className="mt-6 rounded-xl border border-hair bg-paper-card p-5">
        <div className="flex items-baseline justify-between">
          <h3 className="font-display text-sm font-semibold uppercase tracking-wide text-ink-mute">Tendencia de uso de producto</h3>
          {usage?.day && <span className="text-xs text-ink-faint">{usage.days} día(s) · al {usage.day}</span>}
        </div>
        {usage && Object.keys(usage.byApp).length > 0 ? (
          <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-4">
            {Object.entries(usage.byApp).map(([id, a]) => (
              <div key={id} className="rounded-lg border border-hair p-4">
                <div className="font-medium text-ink">{a.name}</div>
                <div className="mt-3 space-y-2.5">
                  {a.metrics.map((m) => {
                    const vals = (usage.series[id]?.[m.metric] ?? []).map((p) => p.value)
                    return (
                      <div key={m.metric} className="flex items-center justify-between gap-3">
                        <span className="flex items-baseline gap-1.5 min-w-0">
                          <span className="font-display font-semibold text-ink">{fmt(m.value)}</span>
                          <span className="text-xs text-ink-mute truncate">{m.metric}</span>
                          <Delta values={vals} />
                        </span>
                        <Sparkline values={vals} />
                      </div>
                    )
                  })}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="mt-3 text-sm text-ink-faint">
            Sin snapshots aún. El cron <code className="font-mono text-ink">sync-usage</code> acumula uno por día; las tendencias aparecen con ≥2 días.
          </p>
        )}
      </div>

      {/* Consumo por tenant */}
      <TenantConsumption />

      {/* Tráfico web */}
      <div className="mt-6 rounded-xl border border-hair bg-paper-card p-5">
        <div className="flex items-baseline justify-between">
          <h3 className="font-display text-sm font-semibold uppercase tracking-wide text-ink-mute">Tráfico web</h3>
          <span className="text-xs text-ink-faint">analítica propia · 30 días</span>
        </div>
        {web && web.totals?.visits30 > 0 ? (
          <>
            <div className="mt-4 flex flex-wrap items-center gap-x-8 gap-y-3">
              <span className="text-sm"><span className="font-display text-2xl font-semibold text-ink">{fmt(web.totals.visits30)}</span> <span className="text-ink-mute">visitas</span></span>
              <span className="text-sm"><span className="font-display text-2xl font-semibold text-ink">{fmt(web.totals.visitors30)}</span> <span className="text-ink-mute">visitantes</span></span>
              <span className="ml-auto"><Sparkline values={(web.series ?? []).map((p) => p.visits)} w={180} h={36} /></span>
            </div>
            <div className="mt-4">
              <div className="text-xs uppercase tracking-wide text-ink-mute border-b border-hair pb-1.5">Rutas más visitadas</div>
              {(web.top ?? []).map((r) => (
                <div key={r.path} className="flex items-center justify-between gap-3 border-b border-hair last:border-0 py-1.5 text-sm">
                  <span className="font-mono text-ink truncate">{r.path}</span>
                  <span className="shrink-0 text-ink-mute"><span className="font-display font-semibold text-ink">{fmt(r.visits30)}</span> · {fmt(r.visitors30)} únicos</span>
                </div>
              ))}
            </div>
          </>
        ) : (
          <p className="mt-3 text-sm text-ink-faint">Aún sin visitas. El pixel en acaciaco.com.mx las registra; aquí verás rutas top y tendencia.</p>
        )}
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

      <p className="mt-6 text-xs text-ink-faint">
        Próxima capa: costos de infraestructura por app e ingresos por tenant.
      </p>
    </div>
  )
}
