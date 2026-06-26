import { useEffect, useState, useCallback } from 'react'
import { supabase } from '../lib/supabase.js'
import { licenseAction } from '../lib/control.js'
import { PageHeader, EmptyState } from '../components/PageHeader.jsx'

const STATUS_STYLE = {
  active: 'bg-emerald-50 text-emerald-700',
  trial: 'bg-blue-50 text-blue-700',
  view_only: 'bg-amber-50 text-amber-700',
  past_due: 'bg-amber-50 text-amber-700',
  suspended: 'bg-red-50 text-red-700',
  canceled: 'bg-red-50 text-red-700',
  cancelled: 'bg-red-50 text-red-700',
  expired: 'bg-red-50 text-red-700',
}

// Mirror of api/_lib/licenseControl.js (client can't import server-only code).
const PLANS = {
  flowfin: ['home', 'family_plus', 'circle'],
  stockflow: ['start', 'growth', 'pro'],
  rumbo: ['trial', 'starter', 'pro', 'enterprise'],
  liuma: ['start', 'growth', 'plus'],
  puntos: ['starter', 'growth', 'pro', 'enterprise'],
}
const HAS_VIEW_ONLY = new Set(['flowfin', 'stockflow', 'liuma', 'puntos']) // rumbo has no view_only

const OP_COPY = {
  reactivate: { label: 'Reactivar', cls: 'border-emerald-200 text-emerald-700 hover:bg-emerald-50', warn: 'Reactiva el acceso de escritura del tenant.' },
  suspend: { label: 'Pausar', cls: 'border-red-200 text-red-700 hover:bg-red-50', warn: 'Suspende la licencia: el tenant NO podrá escribir en la app.' },
  view_only: { label: 'Solo lectura', cls: 'border-amber-200 text-amber-700 hover:bg-amber-50', warn: 'Pasa el tenant a solo lectura (puede consultar, no editar).' },
}

export function Licenses() {
  const [rows, setRows] = useState(null) // null = loading
  const [confirm, setConfirm] = useState(null) // { row, op, plan, label, warn }
  const [busy, setBusy] = useState(false)
  const [flash, setFlash] = useState(null) // { ok, msg }

  const load = useCallback(() => {
    return supabase.from('licenses')
      .select('id, external_id, app_id, plan, status, seats, current_period_end, apps(name), tenants(name)')
      .order('synced_at', { ascending: false })
      .then(({ data, error }) => { if (error) console.error(error.message); setRows(data ?? []) })
  }, [])

  useEffect(() => { load() }, [load])

  async function run() {
    if (!confirm) return
    setBusy(true); setFlash(null)
    const { row, op, plan } = confirm
    try {
      await licenseAction(row.app_id, row.external_id, op, plan)
      await load()
      setFlash({ ok: true, msg: `${OP_COPY[op]?.label ?? 'Cambio de plan'} aplicado a ${row.tenants?.name ?? row.external_id}.` })
      setConfirm(null)
    } catch (e) {
      setFlash({ ok: false, msg: e.message })
    } finally { setBusy(false) }
  }

  const ask = (row, op, plan) => setConfirm({
    row, op, plan,
    label: op === 'set_plan' ? `Cambiar plan a "${plan}"` : OP_COPY[op].label,
    warn: op === 'set_plan' ? `Cambia el plan del tenant a "${plan}".` : OP_COPY[op].warn,
  })

  return (
    <div>
      <PageHeader title="Licencias" subtitle="Estado y control de licencias por tenant. Operas directamente sobre cada app." />

      {flash && <p className={`mb-4 text-sm ${flash.ok ? 'text-emerald-700' : 'text-red-600'}`}>{flash.msg}</p>}

      {rows === null ? (
        <p className="text-sm text-ink-mute">Cargando…</p>
      ) : rows.length === 0 ? (
        <EmptyState icon="license" title="Aún no hay licencias sincronizadas" phase={1}>
          El cron <code className="font-mono text-ink">sync-licenses</code> leerá las licencias de cada app y las mostrará aquí.
        </EmptyState>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-hair bg-paper-card">
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase tracking-wide text-ink-mute border-b border-hair">
              <tr>
                <th className="px-4 py-3">App</th><th className="px-4 py-3">Tenant</th><th className="px-4 py-3">Plan</th>
                <th className="px-4 py-3">Estado</th><th className="px-4 py-3">Renueva</th><th className="px-4 py-3">Control</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const plans = PLANS[r.app_id] ?? []
                const controllable = plans.length > 0
                return (
                  <tr key={r.id} className="border-b border-hair last:border-0 align-middle">
                    <td className="px-4 py-3 font-medium text-ink">{r.apps?.name ?? r.app_id}</td>
                    <td className="px-4 py-3 text-ink-soft">{r.tenants?.name ?? <span className="text-ink-faint">—</span>}</td>
                    <td className="px-4 py-3 text-ink-soft">{r.plan ?? '—'}</td>
                    <td className="px-4 py-3"><span className={`rounded-md px-2 py-0.5 text-xs font-medium ${STATUS_STYLE[r.status] ?? 'bg-paper-subtle text-ink-mute'}`}>{r.status ?? '—'}</span></td>
                    <td className="px-4 py-3 text-ink-soft">{r.current_period_end ? new Date(r.current_period_end).toLocaleDateString('es-MX') : '—'}</td>
                    <td className="px-4 py-3">
                      {!controllable ? <span className="text-xs text-ink-faint">—</span> : (
                        <div className="flex flex-wrap items-center gap-1.5">
                          {r.status !== 'active' && (
                            <button onClick={() => ask(r, 'reactivate')} className={`rounded-md border px-2 py-1 text-xs font-medium ${OP_COPY.reactivate.cls}`}>Reactivar</button>
                          )}
                          {r.status !== 'suspended' && (
                            <button onClick={() => ask(r, 'suspend')} className={`rounded-md border px-2 py-1 text-xs font-medium ${OP_COPY.suspend.cls}`}>Pausar</button>
                          )}
                          {HAS_VIEW_ONLY.has(r.app_id) && r.status !== 'view_only' && (
                            <button onClick={() => ask(r, 'view_only')} className={`rounded-md border px-2 py-1 text-xs font-medium ${OP_COPY.view_only.cls}`}>Solo lectura</button>
                          )}
                          <select value="" onChange={(e) => e.target.value && ask(r, 'set_plan', e.target.value)}
                            className="rounded-md border border-hair bg-white px-2 py-1 text-xs text-ink">
                            <option value="">Plan…</option>
                            {plans.filter((p) => p !== r.plan).map((p) => <option key={p} value={p}>{p}</option>)}
                          </select>
                        </div>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Confirmation modal — every write goes through here */}
      {confirm && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-ink/30 p-4" onClick={() => !busy && setConfirm(null)}>
          <div className="w-full max-w-md rounded-2xl border border-hair bg-paper-card p-6 shadow-card" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-display text-lg font-semibold text-ink">{confirm.label}</h3>
            <p className="mt-1 text-sm text-ink-soft">
              {confirm.row.apps?.name ?? confirm.row.app_id} · <span className="font-medium text-ink">{confirm.row.tenants?.name ?? confirm.row.external_id}</span>
            </p>
            <p className="mt-3 rounded-lg bg-paper-subtle px-3 py-2 text-sm text-ink-soft">{confirm.warn}</p>
            <p className="mt-2 text-xs text-ink-faint">Se aplica directamente sobre la app vía el puente <code className="font-mono">acaciaControl</code>, como <code className="font-mono">role:admin</code>.</p>
            <div className="mt-5 flex justify-end gap-2">
              <button onClick={() => setConfirm(null)} disabled={busy} className="rounded-lg border border-hair px-3 py-1.5 text-sm font-medium text-ink hover:bg-paper-subtle disabled:opacity-50">Cancelar</button>
              <button onClick={run} disabled={busy} className="rounded-lg bg-brand px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-deep disabled:opacity-50">{busy ? 'Aplicando…' : 'Confirmar'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
