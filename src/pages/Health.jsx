import { useEffect, useState, useCallback } from 'react'
import { supabase } from '../lib/supabase.js'
import { runSync } from '../lib/control.js'
import { PageHeader, EmptyState } from '../components/PageHeader.jsx'

const TONE = {
  ok: { dot: 'bg-emerald-500', text: 'text-emerald-700', label: 'Operativo' },
  degraded: { dot: 'bg-amber-500', text: 'text-amber-700', label: 'Degradado' },
  down: { dot: 'bg-red-500', text: 'text-red-700', label: 'Caído' },
  unknown: { dot: 'bg-slate-300', text: 'text-ink-faint', label: 'Sin datos' },
}

function fmtWhen(v) {
  if (!v) return '—'
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString('es-MX', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
}

export function Health() {
  const [apps, setApps] = useState(null)
  const [byApp, setByApp] = useState({}) // app_id -> { latest, checks[] }
  const [busy, setBusy] = useState(false)
  const [flash, setFlash] = useState(null)

  const load = useCallback(async () => {
    const [{ data: appRows }, { data: health }] = await Promise.all([
      supabase.from('apps').select('id, name, backend, url').order('name'),
      supabase.from('app_health').select('app_id, status, latency_ms, checked_at')
        .order('checked_at', { ascending: false }).limit(2000),
    ])
    const grouped = {}
    for (const h of health ?? []) {
      const g = (grouped[h.app_id] ??= { latest: null, checks: [] })
      if (!g.latest) g.latest = h
      g.checks.push(h)
    }
    setApps(appRows ?? [])
    setByApp(grouped)
  }, [])

  useEffect(() => { load() }, [load])

  async function probeAll() {
    if (!apps?.length) return
    setBusy(true); setFlash(null)
    try {
      const res = await Promise.allSettled(apps.map((a) => runSync(a.id, ['health'])))
      const failed = res.filter((r) => r.status === 'rejected').length
      await load()
      setFlash(failed ? { ok: false, msg: `${apps.length - failed}/${apps.length} probadas (${failed} con error).` } : { ok: true, msg: 'Probadas todas las apps.' })
    } catch (e) { setFlash({ ok: false, msg: e.message }) } finally { setBusy(false) }
  }

  // Uptime % over the loaded window: a check counts as "up" unless it's down.
  function uptime(checks) {
    if (!checks?.length) return null
    const up = checks.filter((c) => c.status !== 'down').length
    return Math.round((up / checks.length) * 1000) / 10
  }

  const overall = apps && apps.length
    ? (() => {
        const states = apps.map((a) => byApp[a.id]?.latest?.status ?? 'unknown')
        if (states.some((s) => s === 'down')) return 'down'
        if (states.some((s) => s === 'degraded')) return 'degraded'
        if (states.every((s) => s === 'ok')) return 'ok'
        return 'unknown'
      })()
    : 'unknown'

  return (
    <div>
      <PageHeader title="Salud" subtitle="Disponibilidad y latencia por app. Sondea el puente (Base44) o la URL (sitios).">
        <button onClick={probeAll} disabled={busy || !apps?.length}
          className="rounded-lg border border-hair px-3 py-1.5 text-sm font-medium text-ink hover:bg-paper-subtle disabled:opacity-50">
          {busy ? 'Probando…' : 'Probar ahora'}
        </button>
      </PageHeader>

      {flash && <p className={`mb-4 text-sm ${flash.ok ? 'text-emerald-700' : 'text-red-600'}`}>{flash.msg}</p>}

      {apps === null ? (
        <p className="text-sm text-ink-mute">Cargando…</p>
      ) : apps.length === 0 ? (
        <EmptyState icon="health" title="Sin apps registradas" phase={5}>
          Registra apps para monitorear su disponibilidad.
        </EmptyState>
      ) : (
        <>
          <div className="mb-5 flex items-center gap-2 rounded-xl border border-hair bg-paper-card px-4 py-3">
            <span className={`h-2.5 w-2.5 rounded-full ${TONE[overall].dot}`} />
            <span className={`text-sm font-medium ${TONE[overall].text}`}>
              {overall === 'ok' ? 'Todo operativo' : overall === 'down' ? 'Hay apps caídas' : overall === 'degraded' ? 'Servicio degradado' : 'Sin datos aún'}
            </span>
            <span className="ml-auto text-xs text-ink-faint">{apps.length} apps</span>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {apps.map((a) => {
              const g = byApp[a.id]
              const status = g?.latest?.status ?? 'unknown'
              const t = TONE[status] ?? TONE.unknown
              const up = uptime(g?.checks)
              return (
                <div key={a.id} className="rounded-xl border border-hair bg-paper-card p-4">
                  <div className="flex items-center justify-between">
                    <span className="font-medium text-ink">{a.name}</span>
                    <span className={`inline-flex items-center gap-1.5 text-xs font-medium ${t.text}`}>
                      <span className={`h-2 w-2 rounded-full ${t.dot}`} /> {t.label}
                    </span>
                  </div>
                  <dl className="mt-3 grid grid-cols-3 gap-2 text-center">
                    <div><dt className="text-[11px] uppercase tracking-wide text-ink-faint">Latencia</dt>
                      <dd className="font-display text-lg font-semibold text-ink">{g?.latest?.latency_ms != null ? `${g.latest.latency_ms}ms` : '—'}</dd></div>
                    <div><dt className="text-[11px] uppercase tracking-wide text-ink-faint">Uptime</dt>
                      <dd className="font-display text-lg font-semibold text-ink">{up != null ? `${up}%` : '—'}</dd></div>
                    <div><dt className="text-[11px] uppercase tracking-wide text-ink-faint">Checks</dt>
                      <dd className="font-display text-lg font-semibold text-ink">{g?.checks?.length ?? 0}</dd></div>
                  </dl>
                  <p className="mt-2 text-[11px] text-ink-faint">
                    {a.backend === 'base44' ? 'vía puente' : 'vía URL'} · último {fmtWhen(g?.latest?.checked_at)}
                  </p>
                </div>
              )
            })}
          </div>
          <p className="mt-4 text-xs text-ink-faint">El cron diario <code className="font-mono">sync</code> registra un sondeo por app; usa <strong>Probar ahora</strong> para una medición inmediata.</p>
        </>
      )}
    </div>
  )
}
