import { useEffect, useState, useCallback } from 'react'
import { useParams, Link } from 'react-router-dom'
import { supabase } from '../lib/supabase.js'
import { fetchApps } from '../lib/appRegistry.js'
import { summarizePortfolio } from '../lib/insights.js'
import { runSync, emailStatus } from '../lib/control.js'
import { PageHeader, StatCard } from '../components/PageHeader.jsx'
import { Icon } from '../components/icons.jsx'

const STATUS_LABEL = { active: 'Activas', trial: 'En prueba', view_only: 'Solo lectura', past_due: 'Vencidas', canceled: 'Canceladas', desconocido: 'Sin estado' }
const STATUS_BAR = { active: 'bg-emerald-500', trial: 'bg-brand', view_only: 'bg-amber-400', past_due: 'bg-red-400', canceled: 'bg-ink-faint', desconocido: 'bg-ink-faint' }
const BACKEND_LABEL = { base44: 'Base44', supabase: 'Supabase', external: 'Externo', static: 'Estático' }

// A follow-up reminder is any sent email about renewal / expiry / trial ending.
const FOLLOWUP_RE = /renewal|expiry|expir|trial|reminder|vencim|renov/i

function daysUntil(iso, now) {
  if (!iso) return null
  const d = Math.ceil((new Date(iso).getTime() - now) / 86_400_000)
  return Number.isFinite(d) ? d : null
}

// Build a tenant-aware list of upcoming renewals / trial-ends from raw licenses.
function buildVencimientos(licenses, tenantById, now) {
  const out = []
  for (const l of licenses) {
    const t = tenantById[l.tenant_id] ?? {}
    const base = { tenant_id: l.tenant_id, ext: t.external_id ?? null, name: t.name ?? '(sin tenant)' }
    const dR = daysUntil(l.current_period_end, now)
    if (dR !== null && dR >= 0 && dR <= 45) out.push({ ...base, type: 'renovación', in_days: dR, date: l.current_period_end })
    const dT = daysUntil(l.trial_ends_at, now)
    if (dT !== null && dT >= 0 && dT <= 45) out.push({ ...base, type: 'fin de prueba', in_days: dT, date: l.trial_ends_at })
  }
  return out.sort((a, b) => a.in_days - b.in_days)
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

// Renders the follow-up email status for one tenant inside an expanded row.
function FollowupDetail({ state, emailCapable }) {
  if (!emailCapable) {
    return <p className="text-xs text-ink-faint">Esta app no lleva registro de correos de seguimiento. <span className="text-ink-mute">(Envío manual: próxima fase.)</span></p>
  }
  if (!state || state.loading) return <p className="text-xs text-ink-mute">Cargando estado del correo…</p>
  if (state.error) return <p className="text-xs text-red-600">No se pudo leer: {state.error}</p>
  if (state.supported === false) return <p className="text-xs text-ink-faint">Sin registro de correos para este tenant.</p>

  const sent = (state.records ?? [])
    .filter((r) => r.status === 'sent' && FOLLOWUP_RE.test(r.email_type || ''))
    .sort((a, b) => String(b.sent_at).localeCompare(String(a.sent_at)))
  const last = sent[0]

  return (
    <div className="space-y-2">
      {last ? (
        <div className="flex items-center gap-2 text-xs">
          <span className="inline-flex items-center gap-1 rounded-md bg-emerald-50 px-2 py-0.5 font-medium text-emerald-700">✓ correo enviado</span>
          <span className="text-ink-mute">{last.sent_at ? new Date(last.sent_at).toLocaleDateString('es-MX', { day: 'numeric', month: 'long', year: 'numeric' }) : '—'} · <span className="font-mono">{last.email_type}</span></span>
        </div>
      ) : (
        <div className="flex items-center gap-2 text-xs">
          <span className="inline-flex items-center gap-1 rounded-md bg-amber-50 px-2 py-0.5 font-medium text-amber-700">· sin correo de seguimiento</span>
          <span className="text-ink-faint">aún no se ha enviado recordatorio</span>
        </div>
      )}
      {sent.length > 1 && (
        <div className="text-[11px] text-ink-faint">Historial: {sent.slice(0, 5).map((r) => r.email_type).join(' · ')}</div>
      )}
    </div>
  )
}

export function AppDetail() {
  const { appId } = useParams()
  const [app, setApp] = useState(undefined) // undefined = loading, null = not found
  const [data, setData] = useState(null)
  const [venc, setVenc] = useState([]) // tenant-aware upcoming renewals/trials
  const [usage, setUsage] = useState(null) // { day, metrics:[{metric,value}] }
  const [lastSync, setLastSync] = useState(null)
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(null) // which control action is running
  const [flash, setFlash] = useState(null) // { ok, msg }
  const [openRow, setOpenRow] = useState(null) // expanded vencimiento index
  const [followups, setFollowups] = useState({}) // tenantExt -> { loading, supported, records, error }

  const load = useCallback(async () => {
    const apps = await fetchApps()
    const a = apps.find((x) => x.id === appId) ?? null
    setApp(a)
    if (!a) return

    const [l, t, u] = await Promise.all([
      supabase.from('licenses').select('app_id, status, plan, seats, trial_ends_at, current_period_end, synced_at, tenant_id').eq('app_id', appId),
      supabase.from('tenants').select('id, app_id, external_id, name').eq('app_id', appId),
      supabase.from('usage_daily').select('metric, value, day').eq('app_id', appId).is('tenant_id', null).order('day', { ascending: false }).limit(50),
    ])
    if (l.error) throw l.error
    const licenses = l.data ?? []
    const tenants = t.data ?? []
    setData(summarizePortfolio({ apps: [a], licenses, tenants }))
    setLastSync(licenses.reduce((m, r) => (r.synced_at && (!m || r.synced_at > m) ? r.synced_at : m), null))

    const tenantById = Object.fromEntries(tenants.map((x) => [x.id, x]))
    setVenc(buildVencimientos(licenses, tenantById, Date.now()))

    const rows = u.data ?? []
    if (rows.length) {
      const day = rows[0].day
      setUsage({ day, metrics: rows.filter((r) => r.day === day).map((r) => ({ metric: r.metric, value: r.value })) })
    } else setUsage({ day: null, metrics: [] })
  }, [appId])

  useEffect(() => { load().catch((e) => setError(e.message)) }, [load])

  // Drill into a vencimiento: load its follow-up email status on demand.
  async function toggleRow(i, ext) {
    if (openRow === i) { setOpenRow(null); return }
    setOpenRow(i)
    if (!ext || followups[ext]) return // already cached or no tenant id
    setFollowups((m) => ({ ...m, [ext]: { loading: true } }))
    try {
      const out = await emailStatus(appId, ext)
      setFollowups((m) => ({ ...m, [ext]: { loading: false, supported: out.supported, records: out.records ?? [] } }))
    } catch (e) {
      setFollowups((m) => ({ ...m, [ext]: { loading: false, error: e.message } }))
    }
  }

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
  const emailCap = !!app.config?.email_log

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
            <p className="mt-1 text-xs text-ink-faint">
              Renovaciones y fines de prueba en los próximos 45 días.
              {emailCap ? ' Clic en cada uno para ver si ya se envió el correo de seguimiento.' : ''}
            </p>
            <div className="mt-4 divide-y divide-hair">
              {venc.length === 0 && <p className="text-sm text-ink-faint">Nada por vencer pronto. 🎉</p>}
              {venc.slice(0, 12).map((u, i) => {
                const open = openRow === i
                return (
                  <div key={i} className="py-1.5 first:pt-0">
                    <button onClick={() => toggleRow(i, u.ext)}
                      className="group flex w-full items-center justify-between gap-3 py-1 text-left text-sm">
                      <span className="flex items-center gap-2 min-w-0">
                        <span aria-hidden className={`text-ink-faint transition-transform ${open ? 'rotate-90' : ''}`}>›</span>
                        <span className={`h-1.5 w-1.5 rounded-full ${u.type === 'fin de prueba' ? 'bg-amber-400' : 'bg-brand'}`} />
                        <span className="font-medium text-ink truncate group-hover:text-brand">{u.name}</span>
                        <span className="text-ink-mute">· {u.type}</span>
                      </span>
                      <span className={`shrink-0 rounded-md px-2 py-0.5 text-xs font-medium ${u.in_days <= 7 ? 'bg-red-50 text-red-700' : 'bg-paper-subtle text-ink-mute'}`}>
                        {u.in_days === 0 ? 'hoy' : `en ${u.in_days}d`}
                      </span>
                    </button>
                    {open && (
                      <div className="pl-7 pr-1 pb-2 pt-1">
                        <FollowupDetail state={followups[u.ext]} emailCapable={emailCap} />
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
