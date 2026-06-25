import { useEffect, useState, useCallback } from 'react'
import { useParams, Link } from 'react-router-dom'
import { supabase } from '../lib/supabase.js'
import { fetchApps } from '../lib/appRegistry.js'
import { summarizePortfolio } from '../lib/insights.js'
import { runSync } from '../lib/control.js'
import { PageHeader, StatCard } from '../components/PageHeader.jsx'
import { Icon } from '../components/icons.jsx'

const STATUS_LABEL = { active: 'Activas', trial: 'En prueba', view_only: 'Solo lectura', past_due: 'Vencidas', canceled: 'Canceladas', desconocido: 'Sin estado' }
const STATUS_BAR = { active: 'bg-emerald-500', trial: 'bg-brand', view_only: 'bg-amber-400', past_due: 'bg-red-400', canceled: 'bg-ink-faint', desconocido: 'bg-ink-faint' }
const BACKEND_LABEL = { base44: 'Base44', supabase: 'Supabase', external: 'Externo', static: 'Estático' }

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

export function AppDetail() {
  const { appId } = useParams()
  const [app, setApp] = useState(undefined) // undefined = loading, null = not found
  const [data, setData] = useState(null)
  const [usage, setUsage] = useState(null) // { day, metrics:[{metric,value}] }
  const [lastSync, setLastSync] = useState(null)
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(null) // which control action is running
  const [flash, setFlash] = useState(null) // { ok, msg }

  const load = useCallback(async () => {
    const apps = await fetchApps()
    const a = apps.find((x) => x.id === appId) ?? null
    setApp(a)
    if (!a) return

    const [l, t, u] = await Promise.all([
      supabase.from('licenses').select('app_id, status, plan, seats, trial_ends_at, current_period_end, synced_at').eq('app_id', appId),
      supabase.from('tenants').select('app_id').eq('app_id', appId),
      supabase.from('usage_daily').select('metric, value, day').eq('app_id', appId).is('tenant_id', null).order('day', { ascending: false }).limit(50),
    ])
    if (l.error) throw l.error
    setData(summarizePortfolio({ apps: [a], licenses: l.data ?? [], tenants: t.data ?? [] }))
    setLastSync((l.data ?? []).reduce((m, r) => (r.synced_at && (!m || r.synced_at > m) ? r.synced_at : m), null))

    const rows = u.data ?? []
    if (rows.length) {
      const day = rows[0].day
      setUsage({ day, metrics: rows.filter((r) => r.day === day).map((r) => ({ metric: r.metric, value: r.value })) })
    } else setUsage({ day: null, metrics: [] })
  }, [appId])

  useEffect(() => { load().catch((e) => setError(e.message)) }, [load])

  async function doSync(kinds, label) {
    setBusy(label); setFlash(null)
    try {
      await runSync(appId, kinds)
      await load()
      setFlash({ ok: true, msg: `Sincronización (${label}) lista.` })
    } catch (e) {
      setFlash({ ok: false, msg: e.message })
    } finally { setBusy(null) }
  }

  if (app === undefined) return (<div><PageHeader title="App" /><p className="text-sm text-ink-mute">Cargando…</p></div>)
  if (app === null) {
    return (
      <div>
        <PageHeader title="App no encontrada" />
        <Link to="/" className="text-sm text-brand hover:text-brand-deep">← Volver al portafolio</Link>
      </div>
    )
  }

  const t = data?.totals
  const operable = app.backend === 'base44'

  return (
    <div>
      <div className="mb-1"><Link to="/" className="text-xs text-ink-mute hover:text-ink">← Portafolio</Link></div>
      <PageHeader
        title={app.name}
        subtitle={`${BACKEND_LABEL[app.backend] ?? app.backend}${app.external_id ? ` · ${app.external_id}` : ''} · control y analíticas`}
      >
        {app.url && (
          <a href={app.url} target="_blank" rel="noreferrer"
            className="inline-flex items-center gap-1 text-sm text-ink-mute hover:text-brand">
            Abrir app <Icon name="external" size={13} />
          </a>
        )}
      </PageHeader>

      {error && <p className="mb-4 text-sm text-red-600">No se pudo leer: {error}</p>}

      {/* Control */}
      <div className="rounded-xl border border-hair bg-paper-card p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="font-display text-sm font-semibold uppercase tracking-wide text-ink-mute">Control</h3>
            <p className="mt-1 text-xs text-ink-faint">
              {operable
                ? <>Sincroniza este app vía su puente <code className="font-mono text-ink">acaciaControl</code> (HMAC firmado).{lastSync && <> · última sinc.: {new Date(lastSync).toLocaleString('es-MX')}</>}</>
                : 'Esta app no tiene puente operable (solo catálogo).'}
            </p>
          </div>
          {operable && (
            <div className="flex flex-wrap gap-2">
              <button onClick={() => doSync(['licenses', 'usage'], 'todo')} disabled={!!busy}
                className="rounded-lg bg-brand px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-deep disabled:opacity-50">
                {busy === 'todo' ? 'Sincronizando…' : 'Sincronizar ahora'}
              </button>
              <button onClick={() => doSync(['licenses'], 'licencias')} disabled={!!busy}
                className="rounded-lg border border-hair px-3 py-1.5 text-sm font-medium text-ink hover:border-brand/40 disabled:opacity-50">
                {busy === 'licencias' ? '…' : 'Solo licencias'}
              </button>
              <button onClick={() => doSync(['usage'], 'uso')} disabled={!!busy}
                className="rounded-lg border border-hair px-3 py-1.5 text-sm font-medium text-ink hover:border-brand/40 disabled:opacity-50">
                {busy === 'uso' ? '…' : 'Solo uso'}
              </button>
            </div>
          )}
        </div>
        {flash && (
          <p className={`mt-3 text-sm ${flash.ok ? 'text-emerald-700' : 'text-red-600'}`}>{flash.msg}</p>
        )}
      </div>

      {/* Analytics */}
      {t && (
        <>
          <div className="mt-6 grid grid-cols-2 lg:grid-cols-4 gap-4">
            <StatCard label="Tenants" value={t.tenants} />
            <StatCard label="Licencias" value={t.licenses} hint={`${t.activeRate}% activas`} />
            <StatCard label="Activas" value={t.active} accent />
            <StatCard label="Asientos" value={t.seats} hint={`${data.renewals30} renov. ≤30d`} />
          </div>

          <div className="mt-6 grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Bars title="Licencias por estado" rows={data.byStatus} total={Math.max(1, t.licenses)} colorFor={(k) => STATUS_BAR[k] ?? 'bg-brand'} />
            <Bars title="Licencias por plan" rows={data.byPlan} total={Math.max(1, t.licenses)} />
          </div>

          <div className="mt-6 rounded-xl border border-hair bg-paper-card p-5">
            <div className="flex items-baseline justify-between">
              <h3 className="font-display text-sm font-semibold uppercase tracking-wide text-ink-mute">Uso de producto</h3>
              {usage?.day && <span className="text-xs text-ink-faint">snapshot {usage.day}</span>}
            </div>
            {usage && usage.metrics.length > 0 ? (
              <div className="mt-4 flex flex-wrap gap-x-6 gap-y-2">
                {usage.metrics.map((m) => (
                  <span key={m.metric} className="text-sm">
                    <span className="font-display font-semibold text-ink">{m.value.toLocaleString('es-MX')}</span>
                    <span className="ml-1 text-ink-mute">{m.metric}</span>
                  </span>
                ))}
              </div>
            ) : (
              <p className="mt-3 text-sm text-ink-faint">Sin snapshot aún. Pulsa <span className="font-medium text-ink">Sincronizar ahora</span>.</p>
            )}
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
        </>
      )}
    </div>
  )
}
