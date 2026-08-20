import { useEffect, useState, useCallback } from 'react'
import { supabase } from '../lib/supabase.js'
import { licenseAction, deletePremiumData } from '../lib/control.js'
import { PageHeader, EmptyState } from '../components/PageHeader.jsx'

const STATUS_STYLE = {
  active: 'bg-emerald-50 text-emerald-700',
  trial: 'bg-blue-50 text-blue-700',
  view_only: 'bg-amber-50 text-amber-700',
  read_only: 'bg-amber-50 text-amber-700',
  past_due: 'bg-amber-50 text-amber-700',
  suspended: 'bg-red-50 text-red-700',
  access_denied: 'bg-red-50 text-red-700',
  canceled: 'bg-red-50 text-red-700',
  cancelled: 'bg-red-50 text-red-700',
  expired: 'bg-red-50 text-red-700',
  deletion_eligible: 'bg-red-100 text-red-800 font-semibold',
}

// Mirror of api/_lib/licenseControl.js APPS[app].statuses (client can't import
// server-only code). Only apps whose stored status strings differ from the
// generic op names (active/suspended/view_only) need an entry — CateqHub uses
// read_only/access_denied for clearer in-app copy (see the Premium license
// lifecycle design doc).
const STATUS_VALUES = {
  cateqhub: { active: 'active', suspend: 'access_denied', view_only: 'read_only' },
}
// Every other app stores the literal op-derived strings below; only the op
// name ('suspend') differs from the stored value ('suspended') by default.
const DEFAULT_STATUS_VALUES = { active: 'active', suspend: 'suspended', view_only: 'view_only' }
function statusValue(appId, op) {
  return STATUS_VALUES[appId]?.[op] ?? DEFAULT_STATUS_VALUES[op] ?? op
}

// Mirror of api/_lib/licenseControl.js (client can't import server-only code).
const PLANS = {
  flowfin: ['home', 'family_plus', 'circle'],
  stockflow: ['start', 'growth', 'pro'],
  rumbo: ['trial', 'starter', 'pro', 'enterprise'],
  liuma: ['start', 'growth', 'plus'],
  puntos: ['starter', 'growth', 'pro', 'enterprise'],
  cateqhub: ['free', 'premium'],
  ctrlhq: ['pro'],
  kitchops: ['start', 'growth', 'pro'],
}
const HAS_VIEW_ONLY = new Set(['flowfin', 'stockflow', 'liuma', 'puntos', 'cateqhub', 'ctrlhq', 'kitchops']) // rumbo has no view_only
// Apps that support the renewal/payment-confirmation flow.
const HAS_BILLING = new Set(['flowfin', 'stockflow', 'rumbo', 'liuma', 'puntos', 'ctrlhq', 'kitchops'])
// Per-app expiry-day convention (mirror of api/_lib/licenseControl billing.dayConvention).
const FIRST_OF_MONTH = new Set(['flowfin', 'liuma']) // align to the 1st (Mercado Pago bills on the 1st)

const OP_COPY = {
  reactivate: { label: 'Reactivar', cls: 'border-emerald-200 text-emerald-700 hover:bg-emerald-50', warn: 'Reactiva el acceso de escritura del tenant.' },
  suspend: { label: 'Pausar', cls: 'border-red-200 text-red-700 hover:bg-red-50', warn: 'Suspende la licencia: el tenant NO podrá escribir en la app.' },
  view_only: { label: 'Solo lectura', cls: 'border-amber-200 text-amber-700 hover:bg-amber-50', warn: 'Pasa el tenant a solo lectura (puede consultar, no editar).' },
}

const DAY = 86_400_000
function parseDate(v) {
  if (!v) return null
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? null : d
}
function fmtDate(v) {
  const d = parseDate(v)
  return d ? d.toLocaleDateString('es-MX', { day: 'numeric', month: 'short', year: 'numeric' }) : '—'
}
// Stack a +N-month renewal from the later of (current expiry, today). Preview only
// — api/_lib/licenseControl.js computeRenewalExpiry is authoritative on the server.
function previewExpiry(currentExpiry, months, appId) {
  const now = new Date()
  const cur = parseDate(currentExpiry)
  const base = cur && cur.getTime() > now.getTime() ? cur : now
  const d = new Date(base.getTime())
  const day = d.getDate()
  d.setDate(1); d.setMonth(d.getMonth() + months)
  const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()
  d.setDate(Math.min(day, last))
  // FlowFin / LIUMA land on the 1st of the resulting month (Mercado Pago bills then).
  if (FIRST_OF_MONTH.has(appId)) d.setDate(1)
  return d
}

// Derive the renewal/expiry signal shown next to each license.
function expiryInfo(row) {
  const now = Date.now()
  const isTrial = String(row.status ?? '').toLowerCase() === 'trial'
  const trialEnd = parseDate(row.trial_ends_at)
  const expiry = parseDate(row.current_period_end)
  // On trial: the trial-end date is what matters.
  if (isTrial && trialEnd) {
    const days = Math.round((trialEnd.getTime() - now) / DAY)
    if (days < 0) return { date: trialEnd, label: 'Prueba vencida', tone: 'bad', sub: `terminó ${fmtDate(trialEnd)}` }
    if (days <= 5) return { date: trialEnd, label: `Prueba: ${days}d`, tone: 'warn', sub: `vence ${fmtDate(trialEnd)}` }
    return { date: trialEnd, label: 'En prueba', tone: 'info', sub: `vence ${fmtDate(trialEnd)}` }
  }
  if (expiry) {
    const days = Math.round((expiry.getTime() - now) / DAY)
    if (days < 0) return { date: expiry, label: 'Vencido', tone: 'bad', sub: `venció ${fmtDate(expiry)}` }
    if (days <= 7) return { date: expiry, label: `Vence en ${days}d`, tone: 'warn', sub: fmtDate(expiry) }
    return { date: expiry, label: fmtDate(expiry), tone: 'ok', sub: null }
  }
  return { date: null, label: '—', tone: 'none', sub: null }
}
const TONE_CLS = {
  bad: 'text-red-700 font-medium', warn: 'text-amber-700 font-medium',
  info: 'text-blue-700', ok: 'text-ink-soft', none: 'text-ink-faint',
}

export function Licenses() {
  const [rows, setRows] = useState(null) // null = loading
  const [renewals, setRenewals] = useState({}) // key `app|ext` → { renewed, verified, new_expiry }
  const [confirm, setConfirm] = useState(null) // { row, op, plan, label, warn } | { row, op:'set_addon', addonKey, addonValue, label, warn }
  const [pay, setPay] = useState(null) // { row } — payment-confirmation modal
  const [months, setMonths] = useState(1)
  const [payRef, setPayRef] = useState('')
  const [payEmail, setPayEmail] = useState(true) // enviar correo de confirmación
  const [busy, setBusy] = useState(false)
  const [flash, setFlash] = useState(null) // { ok, msg }
  const [del, setDel] = useState(null) // { row } — delete-premium-data modal
  const [delTyped, setDelTyped] = useState('')

  const load = useCallback(async () => {
    const period = new Date().toISOString().slice(0, 7)
    const [{ data, error }, { data: rem }] = await Promise.all([
      supabase.from('licenses')
        .select('id, external_id, app_id, plan, status, seats, current_period_end, trial_ends_at, auto_renew, raw, apps(name), tenants(name)')
        .order('synced_at', { ascending: false }),
      supabase.from('renewal_reminders')
        .select('app_id, external_id, renewed, verified, new_expiry').eq('period', period).eq('renewed', true),
    ])
    if (error) console.error(error.message)
    setRows(data ?? [])
    setRenewals(Object.fromEntries((rem ?? []).map((r) => [`${r.app_id}|${r.external_id}`, r])))
  }, [])

  useEffect(() => { load() }, [load])

  async function run() {
    if (!confirm) return
    setBusy(true); setFlash(null)
    const { row, op, plan, addonKey, addonValue } = confirm
    try {
      await licenseAction(row.app_id, row.external_id, op, plan, op === 'set_addon' ? { addonKey, addonValue } : {})
      await load()
      setFlash({ ok: true, msg: `${confirm.label ?? OP_COPY[op]?.label ?? 'Cambio'} aplicado a ${row.tenants?.name ?? row.external_id}.` })
      setConfirm(null)
    } catch (e) {
      setFlash({ ok: false, msg: e.message })
    } finally { setBusy(false) }
  }

  async function runDelete() {
    if (!del) return
    setBusy(true); setFlash(null)
    const { row } = del
    try {
      const out = await deletePremiumData(row.app_id, row.external_id, delTyped)
      await load()
      setFlash({ ok: true, msg: `Datos Premium borrados para ${row.tenants?.name ?? row.external_id}: ${JSON.stringify(out.deletedCounts)}.` })
      setDel(null); setDelTyped('')
    } catch (e) {
      setFlash({ ok: false, msg: e.message })
    } finally { setBusy(false) }
  }

  async function runPayment() {
    if (!pay) return
    setBusy(true); setFlash(null)
    const { row } = pay
    try {
      const out = await licenseAction(row.app_id, row.external_id, 'confirm_payment', null, {
        periodMonths: months, paymentReference: payRef.trim() || undefined, sendEmail: payEmail,
      })
      await load()
      const mail = payEmail
        ? (out?.emailed ? ' Correo de confirmación enviado.' : ' (No se pudo enviar el correo: sin destinatario o falló el puente.)')
        : ''
      setFlash({ ok: true, msg: `Pago confirmado para ${row.tenants?.name ?? row.external_id}. Renovado hasta ${fmtDate(out?.newExpiry)}.${mail}` })
      setPay(null); setPayRef(''); setMonths(1); setPayEmail(true)
    } catch (e) {
      setFlash({ ok: false, msg: e.message })
    } finally { setBusy(false) }
  }

  // Confirma que el cargo de Mercado Pago de una auto-renovación sí se realizó.
  // Escribe renewal_reminders directo por Supabase (RLS permite UPDATE a admin).
  async function verifyRenewal(row) {
    const period = new Date().toISOString().slice(0, 7)
    const key = `${row.app_id}|${row.external_id}`
    const { data: { session } } = await supabase.auth.getSession()
    setRenewals((m) => ({ ...m, [key]: { ...m[key], verified: true } }))
    const { error } = await supabase.from('renewal_reminders')
      .update({ verified: true, verified_at: new Date().toISOString(), verified_by: session?.user?.email ?? null })
      .eq('app_id', row.app_id).eq('external_id', row.external_id).eq('period', period)
    if (error) {
      setRenewals((m) => ({ ...m, [key]: { ...m[key], verified: false } })) // revertir
      setFlash({ ok: false, msg: `No se pudo verificar: ${error.message}` })
    }
  }

  // Marca/desmarca cobro automático (metadata de la bodega). El operador es admin,
  // así que RLS permite escribir `licenses` directo por Supabase — sin endpoint.
  async function toggleAutoRenew(row) {
    const next = !row.auto_renew
    setRows((rs) => rs.map((r) => (r.id === row.id ? { ...r, auto_renew: next } : r)))
    const { error } = await supabase.from('licenses').update({ auto_renew: next }).eq('id', row.id)
    if (error) {
      setRows((rs) => rs.map((r) => (r.id === row.id ? { ...r, auto_renew: !next } : r))) // revertir
      setFlash({ ok: false, msg: `No se pudo cambiar el cobro automático: ${error.message}` })
    }
  }

  const ask = (row, op, plan) => setConfirm({
    row, op, plan,
    label: op === 'set_plan' ? `Cambiar plan a "${plan}"` : OP_COPY[op].label,
    warn: op === 'set_plan' ? `Cambia el plan del tenant a "${plan}".` : OP_COPY[op].warn,
  })

  // Add-ons del plan de cobro de CateqHub (implementación asistida, soporte
  // prioritario) — confirma un pago validado manualmente (WhatsApp/factura,
  // sin Mercado Pago para este app todavía). Reutiliza el mismo modal de
  // confirmación que el resto de los ops.
  const askAddon = (row, addonKey, addonValue, label, warn) => setConfirm({ row, op: 'set_addon', addonKey, addonValue, label, warn })

  return (
    <div>
      <PageHeader title="Licencias" subtitle="Estado, vencimiento y control de licencias por tenant. Confirma pagos y opera directamente sobre cada app." />

      {flash && <p className={`mb-4 text-sm ${flash.ok ? 'text-emerald-700' : 'text-red-600'}`}>{flash.msg}</p>}

      {rows === null ? (
        <p className="text-sm text-ink-mute">Cargando…</p>
      ) : rows.length === 0 ? (
        <EmptyState icon="license" title="Aún no hay licencias sincronizadas">
          El cron <code className="font-mono text-ink">sync</code> leerá las licencias de cada app y las mostrará aquí.
        </EmptyState>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-hair bg-paper-card">
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase tracking-wide text-ink-mute border-b border-hair">
              <tr>
                <th className="px-4 py-3">App</th><th className="px-4 py-3">Tenant</th><th className="px-4 py-3">Plan</th>
                <th className="px-4 py-3">Estado</th><th className="px-4 py-3">Vencimiento</th><th className="px-4 py-3">Control</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const plans = PLANS[r.app_id] ?? []
                const controllable = plans.length > 0
                const exp = expiryInfo(r)
                return (
                  <tr key={r.id} className="border-b border-hair last:border-0 align-middle">
                    <td className="px-4 py-3 font-medium text-ink">{r.apps?.name ?? r.app_id}</td>
                    <td className="px-4 py-3 text-ink-soft">{r.tenants?.name ?? <span className="text-ink-faint">—</span>}</td>
                    <td className="px-4 py-3 text-ink-soft">{r.plan ?? '—'}</td>
                    <td className="px-4 py-3">
                      <span className={`rounded-md px-2 py-0.5 text-xs font-medium ${STATUS_STYLE[r.status] ?? 'bg-paper-subtle text-ink-mute'}`}>{r.status ?? '—'}</span>
                      {r.raw?.export_confirmed_at && (
                        <div className="mt-1 text-[11px] text-emerald-600">✓ Exportación confirmada {fmtDate(r.raw.export_confirmed_at)}</div>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`text-xs ${TONE_CLS[exp.tone]}`}>{exp.label}</span>
                      {exp.sub && <div className="text-[11px] text-ink-faint">{exp.sub}</div>}
                      {(() => {
                        const rr = renewals[`${r.app_id}|${r.external_id}`]
                        if (!rr) return null
                        return rr.verified
                          ? <div className="mt-1 text-[11px] text-emerald-600">✓ Auto-renovado y verificado</div>
                          : (
                            <div className="mt-1 flex items-center gap-1.5">
                              <span className="rounded bg-amber-50 px-1.5 py-0.5 text-[11px] font-medium text-amber-700" title="Se renovó automáticamente asumiendo el cargo de Mercado Pago. Confirma que el cobro se realizó.">Auto-renovado · verificar</span>
                              <button onClick={() => verifyRenewal(r)} className="text-[11px] font-medium text-brand hover:underline">Verificar</button>
                            </div>
                          )
                      })()}
                    </td>
                    <td className="px-4 py-3">
                      {!controllable ? <span className="text-xs text-ink-faint">—</span> : (
                        <div className="flex flex-wrap items-center gap-1.5">
                          {HAS_BILLING.has(r.app_id) && (
                            <button onClick={() => { setPay({ row: r }); setMonths(1); setPayRef(''); setPayEmail(true) }}
                              className="rounded-md border border-brand/30 bg-brand/5 px-2 py-1 text-xs font-medium text-brand hover:bg-brand/10">Confirmar pago</button>
                          )}
                          {r.status !== statusValue(r.app_id, 'active') && (
                            <button onClick={() => ask(r, 'reactivate')} className={`rounded-md border px-2 py-1 text-xs font-medium ${OP_COPY.reactivate.cls}`}>Reactivar</button>
                          )}
                          {r.status !== statusValue(r.app_id, 'suspend') && (
                            <button onClick={() => ask(r, 'suspend')} className={`rounded-md border px-2 py-1 text-xs font-medium ${OP_COPY.suspend.cls}`}>Pausar</button>
                          )}
                          {HAS_VIEW_ONLY.has(r.app_id) && r.status !== statusValue(r.app_id, 'view_only') && (
                            <button onClick={() => ask(r, 'view_only')} className={`rounded-md border px-2 py-1 text-xs font-medium ${OP_COPY.view_only.cls}`}>Solo lectura</button>
                          )}
                          {r.status === 'deletion_eligible' && (
                            <button
                              onClick={() => { setDel({ row: r }); setDelTyped('') }}
                              disabled={!r.raw?.export_confirmed_at}
                              title={r.raw?.export_confirmed_at ? undefined : 'El tenant aún no confirmó su exportación'}
                              className="rounded-md border border-red-300 bg-red-50 px-2 py-1 text-xs font-medium text-red-800 hover:bg-red-100 disabled:opacity-40 disabled:cursor-not-allowed"
                            >
                              Borrar datos Premium
                            </button>
                          )}
                          <select value="" onChange={(e) => e.target.value && ask(r, 'set_plan', e.target.value)}
                            className="rounded-md border border-hair bg-white px-2 py-1 text-xs text-ink">
                            <option value="">Plan…</option>
                            {plans.filter((p) => p !== r.plan).map((p) => <option key={p} value={p}>{p}</option>)}
                          </select>
                          {HAS_BILLING.has(r.app_id) && (
                            <button onClick={() => toggleAutoRenew(r)} type="button" role="switch" aria-checked={!!r.auto_renew}
                              title="Cobro automático en Mercado Pago: el día 1 recibe un aviso de cargo en vez del recordatorio de pago."
                              className={`inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs font-medium ${r.auto_renew ? 'border-brand/40 bg-brand/10 text-brand' : 'border-hair text-ink-mute hover:bg-paper-subtle'}`}>
                              <span className={`h-1.5 w-1.5 rounded-full ${r.auto_renew ? 'bg-brand' : 'bg-ink-faint'}`} />
                              Cobro auto
                            </button>
                          )}
                        </div>
                      )}
                      {r.app_id === 'cateqhub' && (() => {
                        // Add-ons del plan de cobro (implementación asistida + soporte
                        // prioritario, ver CLAUDE.md del app hermano). Ambos campos llegan
                        // ya en `raw` porque licenseMapping copia el registro Parish completo,
                        // sin necesitar field_map — ver api/_lib/sync/licenseMapping.js.
                        const impl = r.raw?.implementation_status || 'none'
                        const implTierLabel = r.raw?.implementation_requested_tier || '—'
                        const addonOn = !!r.raw?.support_priority_addon
                        return (
                          <div className="mt-1.5 flex w-full flex-wrap items-center gap-1.5 border-t border-hair pt-1.5">
                            <span className="text-[11px] text-ink-faint">Implementación:</span>
                            <span className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${
                              impl === 'completed' ? 'bg-emerald-50 text-emerald-700'
                                : impl === 'requested' ? 'bg-amber-50 text-amber-700'
                                  : 'bg-paper-subtle text-ink-mute'
                            }`}>
                              {impl === 'completed' ? 'Completada' : impl === 'requested' ? `Solicitada (${implTierLabel})` : 'Sin solicitar'}
                            </span>
                            {impl === 'requested' && (
                              <button
                                onClick={() => askAddon(r, 'implementation', 'completed', 'Marcar implementación como completada',
                                  'Marca la implementación asistida como completada, después de haber confirmado el pago único con la parroquia.')}
                                className="rounded-md border border-emerald-200 px-2 py-1 text-[11px] font-medium text-emerald-700 hover:bg-emerald-50">
                                Marcar completada
                              </button>
                            )}
                            <span className="ml-2 text-[11px] text-ink-faint">Soporte prioritario:</span>
                            <button
                              onClick={() => askAddon(r, 'support_priority', !addonOn, addonOn ? 'Desactivar soporte prioritario' : 'Activar soporte prioritario',
                                addonOn
                                  ? 'Desactiva el add-on de soporte prioritario (vuelve al tope de prioridad normal del plan).'
                                  : 'Activa el add-on de soporte prioritario, después de haber confirmado el pago mensual — sube el tope de prioridad de ticket seleccionable a "urgente".')}
                              type="button" role="switch" aria-checked={addonOn}
                              className={`inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] font-medium ${addonOn ? 'border-brand/40 bg-brand/10 text-brand' : 'border-hair text-ink-mute hover:bg-paper-subtle'}`}>
                              <span className={`h-1.5 w-1.5 rounded-full ${addonOn ? 'bg-brand' : 'bg-ink-faint'}`} />
                              {addonOn ? 'Activo' : 'Inactivo'}
                            </button>
                          </div>
                        )
                      })()}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Confirmation modal — status/plan writes go through here */}
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

      {/* Payment-confirmation modal — renews the license one (or more) periods */}
      {pay && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-ink/30 p-4" onClick={() => !busy && setPay(null)}>
          <div className="w-full max-w-md rounded-2xl border border-hair bg-paper-card p-6 shadow-card" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-display text-lg font-semibold text-ink">Confirmar pago</h3>
            <p className="mt-1 text-sm text-ink-soft">
              {pay.row.apps?.name ?? pay.row.app_id} · <span className="font-medium text-ink">{pay.row.tenants?.name ?? pay.row.external_id}</span>
            </p>
            <p className="mt-3 text-sm text-ink-soft">
              Vencimiento actual: <span className="font-medium text-ink">{fmtDate(pay.row.current_period_end)}</span>
            </p>

            <label className="mt-4 block text-xs font-medium uppercase tracking-wide text-ink-mute">Período pagado</label>
            <div className="mt-1.5 flex gap-2">
              <button onClick={() => setMonths(1)} className={`flex-1 rounded-lg border px-3 py-1.5 text-sm font-medium ${months === 1 ? 'border-brand bg-brand/5 text-brand' : 'border-hair text-ink hover:bg-paper-subtle'}`}>1 mes</button>
              <button onClick={() => setMonths(12)} className={`flex-1 rounded-lg border px-3 py-1.5 text-sm font-medium ${months === 12 ? 'border-brand bg-brand/5 text-brand' : 'border-hair text-ink hover:bg-paper-subtle'}`}>12 meses (anual)</button>
            </div>

            <label className="mt-4 block text-xs font-medium uppercase tracking-wide text-ink-mute">Referencia de pago <span className="text-ink-faint normal-case">(opcional — ID Mercado Pago / folio)</span></label>
            <input value={payRef} onChange={(e) => setPayRef(e.target.value)} placeholder="MP-123456 / nota manual"
              className="mt-1.5 w-full rounded-lg border border-hair bg-white px-3 py-1.5 text-sm text-ink placeholder:text-ink-faint" />

            <label className="mt-4 flex items-start gap-2 text-sm text-ink-soft">
              <input type="checkbox" checked={payEmail} onChange={(e) => setPayEmail(e.target.checked)} className="mt-0.5 accent-brand" />
              <span>Enviar correo de confirmación al admin de la tienda (agradecimiento + vigencia).</span>
            </label>

            <p className="mt-4 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
              Nuevo vencimiento: <span className="font-semibold">{fmtDate(previewExpiry(pay.row.current_period_end, months, pay.row.app_id).toISOString())}</span>. La licencia queda <span className="font-semibold">activa</span>.
            </p>
            <p className="mt-2 text-xs text-ink-faint">Confirma un pago recurrente ya cobrado en Mercado Pago. Se escribe sobre la app vía <code className="font-mono">acaciaControl</code> como <code className="font-mono">role:admin</code>.</p>

            <div className="mt-5 flex justify-end gap-2">
              <button onClick={() => setPay(null)} disabled={busy} className="rounded-lg border border-hair px-3 py-1.5 text-sm font-medium text-ink hover:bg-paper-subtle disabled:opacity-50">Cancelar</button>
              <button onClick={runPayment} disabled={busy} className="rounded-lg bg-brand px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-deep disabled:opacity-50">{busy ? 'Confirmando…' : 'Confirmar pago'}</button>
            </div>
          </div>
        </div>
      )}

      {/* Delete-premium-data modal — the only destructive action here */}
      {del && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-ink/30 p-4" onClick={() => !busy && setDel(null)}>
          <div className="w-full max-w-md rounded-2xl border border-red-200 bg-paper-card p-6 shadow-card" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-display text-lg font-semibold text-red-800">Borrar datos Premium</h3>
            <p className="mt-1 text-sm text-ink-soft">
              {del.row.apps?.name ?? del.row.app_id} · <span className="font-medium text-ink">{del.row.tenants?.name ?? del.row.external_id}</span>
            </p>
            <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">
              Esto borra permanentemente los Tutores y las relaciones tutor-niño de esta parroquia. Los niños, grupos y asistencia NO se ven afectados. Esta acción no se puede deshacer.
            </p>
            <label className="mt-4 block text-xs font-medium uppercase tracking-wide text-ink-mute">
              Escribe el nombre exacto de la parroquia para confirmar: <span className="normal-case text-ink">{del.row.tenants?.name}</span>
            </label>
            <input value={delTyped} onChange={(e) => setDelTyped(e.target.value)}
              className="mt-1.5 w-full rounded-lg border border-hair bg-white px-3 py-1.5 text-sm text-ink" />
            <div className="mt-5 flex justify-end gap-2">
              <button onClick={() => setDel(null)} disabled={busy} className="rounded-lg border border-hair px-3 py-1.5 text-sm font-medium text-ink hover:bg-paper-subtle disabled:opacity-50">Cancelar</button>
              <button onClick={runDelete} disabled={busy || delTyped !== del.row.tenants?.name} className="rounded-lg bg-red-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-800 disabled:opacity-40">{busy ? 'Borrando…' : 'Borrar datos Premium'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
