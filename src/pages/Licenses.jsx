import { useEffect, useMemo, useState, useCallback } from 'react'
import { supabase } from '../lib/supabase.js'
import { licenseAction, deletePremiumData, licenseSetDates, licenseCancel, licenseRecord } from '../lib/control.js'
import { capabilitiesFor, lifecyclePosition, LIFECYCLE_STAGES } from '../lib/licenseCatalog.js'
import { useAuth, roleAtLeast } from '../lib/auth/useAuth.js'
import { useToasts } from '../lib/useToasts.js'
import { PageHeader, EmptyState } from '../components/PageHeader.jsx'
import {
  Button, Badge, SearchInput, FilterChips, Field, TextInput, Select, Toggle,
  ActionMenu, Modal, Callout, ToastStack,
} from '../components/ui.jsx'

// ── Fechas ───────────────────────────────────────────────────────────────────
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
function fmtDay(v) {
  const d = parseDate(v)
  return d ? d.toLocaleDateString('es-MX', { day: 'numeric', month: 'short' }) : '—'
}
// Valor para un <input type="date"> (UTC, igual que como se guarda).
function toDayInput(v) {
  const d = parseDate(v)
  return d ? d.toISOString().slice(0, 10) : ''
}
function daysUntil(v) {
  const d = parseDate(v)
  return d ? Math.round((d.getTime() - Date.now()) / DAY) : null
}
// Vista previa de la renovación por pago. El servidor
// (licenseControl.computeRenewalExpiry) es el que manda; esto solo lo anticipa.
function previewExpiry(currentExpiry, months, dayConvention) {
  const now = new Date()
  const cur = parseDate(currentExpiry)
  const base = cur && cur.getTime() > now.getTime() ? cur : now
  const d = new Date(base.getTime())
  const day = d.getDate()
  d.setDate(1); d.setMonth(d.getMonth() + months)
  const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()
  d.setDate(Math.min(day, last))
  if (dayConvention === 'first_of_month') d.setDate(1)
  return d
}

// ── Estado de la licencia ────────────────────────────────────────────────────
const STATUS_TONE = {
  active: 'ok', trial: 'info',
  view_only: 'warn', read_only: 'warn', past_due: 'warn',
  suspended: 'bad', access_denied: 'bad', canceled: 'bad', cancelled: 'bad', expired: 'bad',
  deletion_eligible: 'critical',
}
const STATUS_LABEL = {
  active: 'Activa', trial: 'En prueba', view_only: 'Solo lectura', read_only: 'Solo lectura',
  past_due: 'Con adeudo', suspended: 'Pausada', access_denied: 'Bloqueada',
  canceled: 'Cancelada', cancelled: 'Cancelada', expired: 'Vencida',
  deletion_eligible: 'Elegible para borrado',
}
const statusLabel = (s) => STATUS_LABEL[s] ?? (s || '—')

// Señal de vencimiento del renglón: qué fecha importa y con cuánta urgencia.
function expirySignal(row) {
  const isTrial = String(row.status ?? '').toLowerCase() === 'trial'
  const trialEnd = parseDate(row.trial_ends_at)
  const expiry = parseDate(row.current_period_end)
  const target = isTrial && trialEnd ? trialEnd : expiry
  if (!target) return { date: null, kind: 'none', days: null, isTrial }
  const days = Math.round((target.getTime() - Date.now()) / DAY)
  if (days < 0) return { date: target, kind: 'overdue', days, isTrial }
  if (days <= 7) return { date: target, kind: 'soon', days, isTrial }
  return { date: target, kind: 'ok', days, isTrial }
}

// ── Barra del ciclo de vida ──────────────────────────────────────────────────
// El elemento propio de esta pantalla. Una licencia vencida no está "vencida" y
// ya: el cron del portafolio la va escalando sola (día 8 solo lectura, 15
// bloqueada, 30 inactiva, 45 elegible para borrado). La barra dibuja esa escala
// real y marca dónde va este tenant, así que el operador ve de un vistazo qué le
// va a pasar y cuándo — que es lo que decide si hay que actuar hoy o no.
const RAIL_SPAN = 45
const RAIL_ZONES = [
  { from: 0, to: 8, cls: 'bg-amber-200' },
  { from: 8, to: 15, cls: 'bg-amber-400' },
  { from: 15, to: 30, cls: 'bg-red-300' },
  { from: 30, to: RAIL_SPAN, cls: 'bg-red-500' },
]

function LifecycleRail({ expiry }) {
  const pos = lifecyclePosition(expiry)
  if (!pos || pos.overdue < 0) return null
  const { overdue, stage } = pos
  const pct = Math.min(overdue / RAIL_SPAN, 1) * 100
  const next = LIFECYCLE_STAGES.find((s) => s.days > overdue)
  const nextDate = next ? new Date(parseDate(expiry).getTime() + next.days * DAY) : null

  return (
    <div className="mt-1.5 max-w-[14rem]">
      <div className="flex h-1.5 gap-px" title={`Vencida hace ${overdue} día${overdue === 1 ? '' : 's'}`}>
        {RAIL_ZONES.map((z) => (
          <div key={z.from} className={`rounded-full ${z.cls} ${overdue >= z.to ? '' : 'opacity-40'}`} style={{ width: `${((z.to - z.from) / RAIL_SPAN) * 100}%` }} />
        ))}
      </div>
      <div className="relative h-0">
        <span className="absolute -top-[7px] h-2.5 w-0.5 rounded-full bg-ink" style={{ left: `calc(${pct}% - 1px)` }} />
      </div>
      <p className="mt-1.5 text-[11px] leading-tight text-ink-mute">
        <span className="font-medium text-ink-soft">{stage?.label ?? 'Gracia'}</span>
        {next && nextDate
          ? <> → {next.label.toLowerCase()} el {fmtDay(nextDate)}</>
          : <> · el ciclo ya no avanza más</>}
      </p>
    </div>
  )
}

// ── Página ───────────────────────────────────────────────────────────────────
const VIEWS = [
  { value: 'attention', label: 'Requieren atención' },
  { value: 'all', label: 'Todas' },
  { value: 'active', label: 'Activas' },
  { value: 'trial', label: 'En prueba' },
  { value: 'archived', label: 'Dadas de baja' },
]

export function Licenses() {
  const { role } = useAuth()
  const isOwner = roleAtLeast(role, 'owner')
  const { toasts, ok, fail, dismiss } = useToasts()

  const [rows, setRows] = useState(null) // null = cargando
  const [renewals, setRenewals] = useState({}) // `app|ext` → { renewed, verified }
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [expanded, setExpanded] = useState(null) // license id

  // Filtros
  const [q, setQ] = useState('')
  const [app, setApp] = useState('all')
  const [view, setView] = useState('attention')

  // Modales (uno a la vez)
  const [confirm, setConfirm] = useState(null) // cambio de estado / plan / add-on
  const [pay, setPay] = useState(null)
  const [dates, setDates] = useState(null)
  const [cancel, setCancel] = useState(null)
  const [purge, setPurge] = useState(null)
  const [del, setDel] = useState(null) // borrado de datos Premium (cateqhub)

  // Campos de los modales
  const [months, setMonths] = useState(1)
  const [payRef, setPayRef] = useState('')
  const [payEmail, setPayEmail] = useState(true)
  const [planPick, setPlanPick] = useState('')
  const [expiryInput, setExpiryInput] = useState('')
  const [trialInput, setTrialInput] = useState('')
  const [alsoActivate, setAlsoActivate] = useState(false)
  const [reason, setReason] = useState('')
  const [typed, setTyped] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    const period = new Date().toISOString().slice(0, 7)
    const [{ data, error }, { data: rem }] = await Promise.all([
      supabase.from('licenses')
        .select('id, external_id, app_id, plan, status, seats, current_period_end, trial_ends_at, auto_renew, archived_at, archived_by, archive_reason, raw, apps(name), tenants(name)')
        .order('synced_at', { ascending: false }),
      supabase.from('renewal_reminders')
        .select('app_id, external_id, renewed, verified, new_expiry').eq('period', period).eq('renewed', true),
    ])
    if (error) fail(`No se pudieron cargar las licencias: ${error.message}`)
    setRows(data ?? [])
    setRenewals(Object.fromEntries((rem ?? []).map((r) => [`${r.app_id}|${r.external_id}`, r])))
    setLoading(false)
  }, [fail])

  useEffect(() => { load() }, [load])

  // ── Filtrado ───────────────────────────────────────────────────────────────
  const live = useMemo(() => (rows ?? []).filter((r) => !r.archived_at), [rows])
  const archived = useMemo(() => (rows ?? []).filter((r) => r.archived_at), [rows])

  const needsAttention = useCallback((r) => {
    const s = expirySignal(r)
    return s.kind === 'overdue' || s.kind === 'soon' || r.status === 'deletion_eligible'
  }, [])

  const appOptions = useMemo(() => {
    const pool = view === 'archived' ? archived : live
    const counts = new Map()
    for (const r of pool) counts.set(r.app_id, (counts.get(r.app_id) ?? 0) + 1)
    const names = new Map(pool.map((r) => [r.app_id, r.apps?.name ?? r.app_id]))
    return [
      { value: 'all', label: 'Todas las apps', count: pool.length },
      ...[...counts.entries()]
        .sort((a, b) => names.get(a[0]).localeCompare(names.get(b[0])))
        .map(([id, count]) => ({ value: id, label: names.get(id), count })),
    ]
  }, [live, archived, view])

  const viewOptions = useMemo(() => VIEWS.map((v) => ({
    ...v,
    count: v.value === 'archived' ? archived.length
      : v.value === 'all' ? live.length
        : v.value === 'attention' ? live.filter(needsAttention).length
          : live.filter((r) => (v.value === 'trial' ? r.status === 'trial' : r.status === capabilitiesFor(r.app_id)?.statuses.active)).length,
  })), [live, archived, needsAttention])

  const visible = useMemo(() => {
    const pool = view === 'archived' ? archived : live
    const needle = q.trim().toLowerCase()
    return pool
      .filter((r) => (app === 'all' || r.app_id === app))
      .filter((r) => {
        if (view === 'attention') return needsAttention(r)
        if (view === 'trial') return r.status === 'trial'
        if (view === 'active') return r.status === capabilitiesFor(r.app_id)?.statuses.active
        return true
      })
      .filter((r) => !needle || [r.tenants?.name, r.apps?.name, r.app_id, r.external_id, r.plan, statusLabel(r.status)]
        .some((f) => String(f ?? '').toLowerCase().includes(needle)))
      // Lo más urgente arriba: la fecha más vieja primero, sin fecha al final.
      .sort((a, b) => {
        const da = expirySignal(a).date?.getTime() ?? Infinity
        const db = expirySignal(b).date?.getTime() ?? Infinity
        return da - db
      })
  }, [live, archived, view, app, q, needsAttention])

  const filtersOn = q !== '' || app !== 'all' || view !== 'all'
  const clearFilters = () => { setQ(''); setApp('all'); setView('all') }

  // ── Acciones ───────────────────────────────────────────────────────────────
  const nameOf = (r) => r.tenants?.name ?? r.external_id

  async function withBusy(fn) {
    setBusy(true)
    try { await fn() } finally { setBusy(false) }
  }

  const runConfirm = () => withBusy(async () => {
    const { row, op, plan, addonKey, addonValue, label } = confirm
    try {
      await licenseAction(row.app_id, row.external_id, op, plan, op === 'set_addon' ? { addonKey, addonValue } : {})
      await load()
      setConfirm(null)
      ok(`${label} · ${nameOf(row)}`)
    } catch (e) { fail(e.message) }
  })

  const runPayment = () => withBusy(async () => {
    const { row } = pay
    try {
      const out = await licenseAction(row.app_id, row.external_id, 'confirm_payment', null, {
        periodMonths: months, paymentReference: payRef.trim() || undefined, sendEmail: payEmail,
      })
      await load()
      setPay(null); setPayRef(''); setMonths(1); setPayEmail(true)
      const mail = payEmail
        ? (out?.emailed ? ' Se envió el correo de confirmación.' : ' No se pudo enviar el correo: revisa el contacto del tenant.')
        : ''
      ok(`Pago confirmado · ${nameOf(row)} queda activa hasta el ${fmtDate(out?.newExpiry)}.${mail}`)
    } catch (e) { fail(e.message) }
  })

  const runDates = () => withBusy(async () => {
    const { row } = dates
    try {
      const out = await licenseSetDates(row.app_id, row.external_id, {
        expiryDate: expiryInput || undefined,
        trialEndsAt: trialInput || undefined,
        alsoActivate,
      })
      await load()
      setDates(null)
      ok(`Fechas actualizadas · ${nameOf(row)}${out?.newExpiry ? ` vence el ${fmtDate(out.newExpiry)}` : ''}.`)
    } catch (e) { fail(e.message) }
  })

  const runCancel = () => withBusy(async () => {
    const { row } = cancel
    try {
      const out = await licenseCancel(row.app_id, row.external_id, reason.trim() || undefined)
      await load()
      setCancel(null); setReason(''); setTyped('')
      ok(out?.archived === false
        ? `Licencia cancelada en la app · ${nameOf(row)}. El renglón no se pudo archivar; quítalo del panel desde su menú.`
        : `Licencia dada de baja · ${nameOf(row)}. Puedes restaurarla desde "Dadas de baja".`)
    } catch (e) { fail(e.message) }
  })

  const runRecord = (row, op) => withBusy(async () => {
    try {
      await licenseRecord(row.app_id, row.external_id, op, reason.trim() || undefined)
      await load()
      setPurge(null); setTyped('')
      ok({
        restore: `Licencia restaurada en el panel · ${nameOf(row)}. Su estado en la app no cambió.`,
        archive: `Licencia quitada del panel · ${nameOf(row)}. La encuentras en “Dadas de baja”.`,
        purge: `Renglón borrado · ${nameOf(row)}. Si el registro sigue vivo en la app, el próximo sync lo traerá de vuelta.`,
      }[op])
    } catch (e) { fail(e.message) }
  })

  const runDeletePremium = () => withBusy(async () => {
    const { row } = del
    try {
      const out = await deletePremiumData(row.app_id, row.external_id, typed)
      await load()
      setDel(null); setTyped('')
      ok(`Datos Premium borrados · ${nameOf(row)}: ${JSON.stringify(out.deletedCounts)}`)
    } catch (e) { fail(e.message) }
  })

  // Cobro automático: metadata de la bodega, se guarda sola (sin confirmación).
  async function toggleAutoRenew(row) {
    const next = !row.auto_renew
    setRows((rs) => rs.map((r) => (r.id === row.id ? { ...r, auto_renew: next } : r)))
    const { error } = await supabase.from('licenses').update({ auto_renew: next }).eq('id', row.id)
    if (error) {
      setRows((rs) => rs.map((r) => (r.id === row.id ? { ...r, auto_renew: !next } : r)))
      fail(`No se pudo cambiar el cobro automático: ${error.message}`)
    }
  }

  // Confirma que el cargo automático de Mercado Pago sí se realizó.
  async function verifyRenewal(row) {
    const period = new Date().toISOString().slice(0, 7)
    const key = `${row.app_id}|${row.external_id}`
    const { data: { session } } = await supabase.auth.getSession()
    setRenewals((m) => ({ ...m, [key]: { ...m[key], verified: true } }))
    const { error } = await supabase.from('renewal_reminders')
      .update({ verified: true, verified_at: new Date().toISOString(), verified_by: session?.user?.email ?? null })
      .eq('app_id', row.app_id).eq('external_id', row.external_id).eq('period', period)
    if (error) {
      setRenewals((m) => ({ ...m, [key]: { ...m[key], verified: false } }))
      fail(`No se pudo marcar como verificada: ${error.message}`)
    }
  }

  // ── Aperturas de modal ─────────────────────────────────────────────────────
  const askStatus = (row, op) => setConfirm({
    row, op,
    label: { reactivate: 'Licencia reactivada', suspend: 'Licencia pausada', view_only: 'Licencia en solo lectura' }[op],
    title: { reactivate: 'Reactivar licencia', suspend: 'Pausar licencia', view_only: 'Pasar a solo lectura' }[op],
    warn: {
      reactivate: 'El tenant recupera el acceso de escritura en la app.',
      suspend: 'El tenant deja de poder escribir en la app. Puede volver a activarse cuando quieras.',
      view_only: 'El tenant podrá consultar su información, pero no editarla.',
    }[op],
    tone: op === 'reactivate' ? 'ok' : 'warn',
  })

  const askPlan = (row) => { setPlanPick(''); setConfirm({ row, op: 'set_plan', title: 'Cambiar plan', pickPlan: true, tone: 'neutral' }) }

  const askAddon = (row, addonKey, addonValue, title, warn, label) =>
    setConfirm({ row, op: 'set_addon', addonKey, addonValue, title, warn, label, tone: 'neutral' })

  const askDates = (row) => {
    setExpiryInput(toDayInput(row.current_period_end))
    setTrialInput(toDayInput(row.trial_ends_at))
    setAlsoActivate(false)
    setDates({ row })
  }

  const askCancel = (row) => { setReason(''); setTyped(''); setCancel({ row }) }

  // ── Render ─────────────────────────────────────────────────────────────────
  const capsOf = (r) => capabilitiesFor(r.app_id)

  function rowActions(r) {
    const caps = capsOf(r)
    if (r.archived_at) {
      return [
        { label: 'Restaurar en el panel', hint: 'Vuelve a la lista. No cambia su estado en la app.', onClick: () => runRecord(r, 'restore') },
        isOwner && { separator: true },
        isOwner && { label: 'Borrar renglón…', tone: 'danger', hint: 'Solo de la bodega. El sync puede traerlo de vuelta.', onClick: () => { setTyped(''); setPurge({ row: r }) } },
      ]
    }
    if (!caps) {
      return [
        { label: 'Quitar del panel…', tone: 'danger', hint: 'Esta app no tiene control de licencia.', onClick: () => { setReason(''); setTyped(''); setPurge({ row: r, archiveOnly: true }) } },
      ]
    }
    return [
      r.status !== caps.statuses.active && { label: 'Reactivar', onClick: () => askStatus(r, 'reactivate') },
      caps.hasViewOnly && r.status !== caps.statuses.view_only && { label: 'Pasar a solo lectura', onClick: () => askStatus(r, 'view_only') },
      r.status !== caps.statuses.suspend && { label: 'Pausar', onClick: () => askStatus(r, 'suspend') },
      { separator: true },
      caps.plans.length > 1 && { label: 'Cambiar plan…', onClick: () => askPlan(r) },
      (caps.hasExpiry || caps.hasTrial) && { label: 'Editar fechas…', hint: 'Vencimiento y fin de prueba, a mano.', onClick: () => askDates(r) },
      caps.hasBilling && { label: r.auto_renew ? 'Quitar cobro automático' : 'Marcar cobro automático', onClick: () => toggleAutoRenew(r) },
      { separator: true },
      r.status === 'deletion_eligible' && {
        label: 'Borrar datos Premium…', tone: 'danger', disabled: !r.raw?.export_confirmed_at,
        title: r.raw?.export_confirmed_at ? undefined : 'El tenant aún no confirma su exportación',
        onClick: () => { setTyped(''); setDel({ row: r }) },
      },
      { label: 'Dar de baja…', tone: 'danger', hint: 'La cancela en la app y la saca del panel.', onClick: () => askCancel(r) },
    ]
  }

  function StatusCell({ r }) {
    return (
      <>
        <Badge tone={r.archived_at ? 'neutral' : (STATUS_TONE[r.status] ?? 'neutral')}>{statusLabel(r.status)}</Badge>
        {r.archived_at && <Badge tone="neutral" className="ml-1.5">Dada de baja</Badge>}
        {r.auto_renew && !r.archived_at && (
          <div className="mt-1 text-[11px] text-brand" title="Mercado Pago cobra solo el día 1">Cobro automático</div>
        )}
      </>
    )
  }

  function ExpiryCell({ r }) {
    const s = expirySignal(r)
    const rr = renewals[`${r.app_id}|${r.external_id}`]
    return (
      <>
        <div className="flex items-baseline gap-1.5">
          <span className={`text-sm tabular-nums ${
            r.archived_at ? 'text-ink-mute'
              : s.kind === 'overdue' ? 'font-semibold text-red-700'
                : s.kind === 'soon' ? 'font-semibold text-amber-700' : 'text-ink-soft'
          }`}>
            {s.date ? fmtDate(s.date) : '—'}
          </span>
          {!r.archived_at && s.kind === 'overdue' && <span className="text-[11px] text-red-600">hace {Math.abs(s.days)} d</span>}
          {!r.archived_at && s.kind === 'soon' && <span className="text-[11px] text-amber-700">en {s.days} d</span>}
        </div>
        {s.isTrial && s.date && <div className="text-[11px] text-blue-700">fin de la prueba</div>}
        {!r.archived_at && <LifecycleRail expiry={s.date?.toISOString()} />}
        {rr && !rr.verified && !r.archived_at && (
          <div className="mt-1.5 flex items-center gap-1.5">
            <Badge tone="warn" title="Se renovó sola asumiendo el cargo de Mercado Pago. Falta confirmar que el cobro entró.">Cobro por verificar</Badge>
            <button onClick={() => verifyRenewal(r)} className="text-[11px] font-medium text-brand hover:underline">Verificar</button>
          </div>
        )}
        {rr?.verified && <div className="mt-1 text-[11px] text-emerald-600">Cobro verificado</div>}
      </>
    )
  }

  function RowDetails({ r }) {
    const caps = capsOf(r)
    return (
      <div className="grid gap-4 rounded-xl bg-paper-subtle/70 p-4 sm:grid-cols-2">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-wide text-ink-mute">Identificadores</div>
          <dl className="mt-1.5 space-y-1 text-xs text-ink-soft">
            <div className="flex gap-2"><dt className="w-24 shrink-0 text-ink-faint">App</dt><dd className="font-mono">{r.app_id}</dd></div>
            <div className="flex gap-2"><dt className="w-24 shrink-0 text-ink-faint">Licencia</dt><dd className="break-all font-mono">{r.external_id}</dd></div>
            {r.seats != null && <div className="flex gap-2"><dt className="w-24 shrink-0 text-ink-faint">Usuarios</dt><dd className="tabular-nums">{r.seats}</dd></div>}
            <div className="flex gap-2"><dt className="w-24 shrink-0 text-ink-faint">Prueba</dt><dd className="tabular-nums">{fmtDate(r.trial_ends_at)}</dd></div>
            <div className="flex gap-2"><dt className="w-24 shrink-0 text-ink-faint">Vence</dt><dd className="tabular-nums">{fmtDate(r.current_period_end)}</dd></div>
          </dl>
          {r.archived_at && (
            <p className="mt-2 text-xs text-ink-mute">
              Dada de baja el {fmtDate(r.archived_at)}{r.archived_by ? ` por ${r.archived_by}` : ''}
              {r.archive_reason ? ` — “${r.archive_reason}”` : ''}.
            </p>
          )}
          {r.raw?.export_confirmed_at && (
            <p className="mt-2 text-xs text-emerald-700">Exportación confirmada el {fmtDate(r.raw.export_confirmed_at)}.</p>
          )}
        </div>

        <div>
          {!caps && <p className="text-xs text-ink-mute">Esta app no tiene control de licencia en Mission Control: se muestra tal como llega del sync.</p>}
          {caps?.hasBilling && !r.archived_at && (
            <>
              <div className="text-[11px] font-semibold uppercase tracking-wide text-ink-mute">Cobro</div>
              <div className="mt-1.5">
                <Toggle
                  checked={!!r.auto_renew} onChange={() => toggleAutoRenew(r)} label="Cobro automático"
                  title="Con esto activado, el día 1 el tenant recibe un aviso de cargo en vez del recordatorio de pago."
                />
              </div>
            </>
          )}
          {caps?.addons.includes('implementation') && !r.archived_at && (
            <CateqhubAddons r={r} onAddon={askAddon} />
          )}
        </div>
      </div>
    )
  }

  const total = rows?.length ?? 0

  return (
    <div>
      <PageHeader
        title="Licencias"
        subtitle="Todo el ciclo de una licencia, por tenant: pagos, estado, fechas y bajas. Cada cambio se escribe en la app correspondiente."
      >
        <Button variant="secondary" onClick={load} disabled={loading}>{loading ? 'Actualizando…' : 'Actualizar'}</Button>
      </PageHeader>

      {rows === null ? (
        <div className="space-y-2">
          {[0, 1, 2].map((i) => <div key={i} className="h-16 animate-pulse rounded-xl bg-paper-subtle" />)}
        </div>
      ) : total === 0 ? (
        <EmptyState icon="license" title="Aún no hay licencias sincronizadas">
          El cron <code className="font-mono text-ink">sync</code> lee las licencias de cada app y las deja aquí.
          También puedes lanzarlo a mano desde la página de la app.
        </EmptyState>
      ) : (
        <>
          {/* Filtros. El de app es el primero porque es con el que se entra:
              "a ver qué trae StockFlow". Las cuentas viven en los propios chips
              para que el filtro también se lea como resumen. */}
          <div className="mb-5 space-y-3">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <SearchInput value={q} onChange={setQ} placeholder="Buscar tenant, app o id de licencia…" className="sm:max-w-sm" />
              <div className="sm:ml-auto"><FilterChips options={viewOptions} value={view} onChange={setView} ariaLabel="Filtrar por situación" /></div>
            </div>
            <FilterChips options={appOptions} value={app} onChange={setApp} ariaLabel="Filtrar por app" />
          </div>

          {visible.length === 0 ? (
            <div className="rounded-2xl border border-hair bg-paper-card px-8 py-12 text-center">
              <h2 className="font-display text-lg font-semibold text-ink">Sin licencias con estos filtros</h2>
              <p className="mx-auto mt-1.5 max-w-md text-sm text-ink-soft">
                {view === 'attention'
                  ? 'Nada por vencer ni vencido: el portafolio está al corriente.'
                  : 'Prueba con otra app o quita el texto de búsqueda.'}
              </p>
              {filtersOn && <Button className="mt-4" onClick={clearFilters}>Ver todas</Button>}
            </div>
          ) : (
            <div className="overflow-hidden rounded-xl border border-hair bg-paper-card">
              {/* Encabezado de tabla solo en pantallas anchas; abajo cada
                  licencia es una tarjeta, que en el celular se lee mucho mejor
                  que una tabla con scroll horizontal. */}
              <div className="hidden border-b border-hair px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-ink-mute lg:grid lg:grid-cols-[minmax(0,2fr)_7rem_9rem_minmax(0,1.5fr)_11rem] lg:gap-4">
                <div>Tenant</div><div>Plan</div><div>Estado</div><div>Vencimiento</div><div className="text-right">Acciones</div>
              </div>

              <ul>
                {visible.map((r) => {
                  const caps = capsOf(r)
                  const open = expanded === r.id
                  return (
                    <li key={r.id} className={`border-b border-hair last:border-0 ${r.archived_at ? 'bg-paper-subtle/40' : ''}`}>
                      <div className="grid gap-3 px-4 py-3 lg:grid-cols-[minmax(0,2fr)_7rem_9rem_minmax(0,1.5fr)_11rem] lg:items-start lg:gap-4">
                        {/* Tenant + app */}
                        <div className="min-w-0">
                          <button
                            onClick={() => setExpanded(open ? null : r.id)}
                            aria-expanded={open}
                            className="group flex w-full items-center gap-1.5 text-left"
                          >
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
                              className={`shrink-0 text-ink-faint transition-transform group-hover:text-ink-mute ${open ? 'rotate-90' : ''}`}>
                              <path d="m9 18 6-6-6-6" />
                            </svg>
                            <span className={`truncate font-medium ${r.archived_at ? 'text-ink-mute' : 'text-ink'} group-hover:underline`}>
                              {r.tenants?.name ?? r.external_id}
                            </span>
                          </button>
                          <div className="ml-[18px] truncate text-xs text-ink-mute">{r.apps?.name ?? r.app_id}</div>
                        </div>

                        {/* Plan */}
                        <div className="text-sm text-ink-soft lg:pt-0.5">
                          <span className="lg:hidden text-xs text-ink-faint">Plan: </span>{r.plan ?? '—'}
                        </div>

                        {/* Estado */}
                        <div className="lg:pt-0.5"><StatusCell r={r} /></div>

                        {/* Vencimiento */}
                        <div><ExpiryCell r={r} /></div>

                        {/* Acciones */}
                        <div className="flex items-start justify-end gap-1.5">
                          {caps?.hasBilling && !r.archived_at && (
                            <Button size="sm" variant="primary" onClick={() => { setPay({ row: r }); setMonths(1); setPayRef(''); setPayEmail(true) }}>
                              Confirmar pago
                            </Button>
                          )}
                          <ActionMenu items={rowActions(r)} />
                        </div>
                      </div>

                      {open && <div className="px-4 pb-4"><RowDetails r={r} /></div>}
                    </li>
                  )
                })}
              </ul>
            </div>
          )}

          <p className="mt-3 text-xs text-ink-faint">
            {visible.length} de {view === 'archived' ? archived.length : live.length} licencias
            {view === 'archived' ? ' dadas de baja' : ' activas en el panel'}. Ordenadas por vencimiento, lo más urgente primero.
          </p>
        </>
      )}

      {/* ── Cambio de estado / plan / add-on ── */}
      <Modal
        open={!!confirm} busy={busy} onClose={() => setConfirm(null)}
        title={confirm?.title}
        subtitle={confirm && <>{confirm.row.apps?.name ?? confirm.row.app_id} · <span className="font-medium text-ink">{nameOf(confirm.row)}</span></>}
        footer={
          <>
            <Button onClick={() => setConfirm(null)} disabled={busy}>Cancelar</Button>
            <Button variant="primary" onClick={runConfirm} disabled={busy || (confirm?.pickPlan && !planPick)}>
              {busy ? 'Aplicando…' : 'Aplicar en la app'}
            </Button>
          </>
        }
      >
        {confirm?.pickPlan ? (
          <>
            <Field label="Plan nuevo" hint={`hoy: ${confirm.row.plan ?? '—'}`}>
              <Select value={planPick} onChange={(e) => { setPlanPick(e.target.value); setConfirm((c) => ({ ...c, plan: e.target.value, label: `Plan cambiado a ${e.target.value}` })) }}>
                <option value="">Elige un plan…</option>
                {(capsOf(confirm.row)?.plans ?? []).filter((p) => p !== confirm.row.plan).map((p) => <option key={p} value={p}>{p}</option>)}
              </Select>
            </Field>
            <p className="mt-3 text-xs text-ink-faint">
              El plan cambia en la app de inmediato. No modifica el vencimiento ni cobra nada.
            </p>
          </>
        ) : (
          <Callout tone={confirm?.tone === 'ok' ? 'ok' : 'warn'}>{confirm?.warn}</Callout>
        )}
        <p className="mt-3 text-xs text-ink-faint">
          Se escribe directamente en la app vía <code className="font-mono">acaciaControl</code>, como <code className="font-mono">role:admin</code>.
        </p>
      </Modal>

      {/* ── Confirmar pago ── */}
      <Modal
        open={!!pay} busy={busy} onClose={() => setPay(null)}
        title="Confirmar pago"
        subtitle={pay && <>{pay.row.apps?.name ?? pay.row.app_id} · <span className="font-medium text-ink">{nameOf(pay.row)}</span></>}
        footer={
          <>
            <Button onClick={() => setPay(null)} disabled={busy}>Cancelar</Button>
            <Button variant="primary" onClick={runPayment} disabled={busy}>{busy ? 'Confirmando…' : 'Confirmar pago'}</Button>
          </>
        }
      >
        {pay && (
          <>
            <p className="text-sm text-ink-soft">
              Vencimiento actual: <span className="font-medium tabular-nums text-ink">{fmtDate(pay.row.current_period_end)}</span>
            </p>
            <Field label="Período pagado">
              <div className="flex gap-2">
                {[{ m: 1, l: '1 mes' }, { m: 12, l: '12 meses (anual)' }].map(({ m, l }) => (
                  <button key={m} onClick={() => setMonths(m)}
                    className={`flex-1 rounded-lg border px-3 py-1.5 text-sm font-medium ${months === m ? 'border-brand bg-brand/5 text-brand' : 'border-hair text-ink hover:bg-paper-subtle'}`}>
                    {l}
                  </button>
                ))}
              </div>
            </Field>
            <Field label="Referencia de pago" hint="opcional — id de Mercado Pago o folio">
              <TextInput value={payRef} onChange={(e) => setPayRef(e.target.value)} placeholder="MP-123456" />
            </Field>
            <label className="mt-4 flex items-start gap-2 text-sm text-ink-soft">
              <input type="checkbox" checked={payEmail} onChange={(e) => setPayEmail(e.target.checked)} className="mt-0.5 accent-brand" />
              <span>Enviar correo de confirmación al administrador del tenant.</span>
            </label>
            <div className="mt-4">
              <Callout tone="ok">
                Queda <span className="font-semibold">activa</span> hasta el{' '}
                <span className="font-semibold tabular-nums">
                  {fmtDate(previewExpiry(pay.row.current_period_end, months, capsOf(pay.row)?.dayConvention).toISOString())}
                </span>. Si aún no vencía, el período se suma al que ya tenía.
              </Callout>
            </div>
          </>
        )}
      </Modal>

      {/* ── Editar fechas a mano ── */}
      <Modal
        open={!!dates} busy={busy} onClose={() => setDates(null)}
        title="Editar fechas"
        subtitle={dates && <>{dates.row.apps?.name ?? dates.row.app_id} · <span className="font-medium text-ink">{nameOf(dates.row)}</span></>}
        footer={
          <>
            <Button onClick={() => setDates(null)} disabled={busy}>Cancelar</Button>
            <Button variant="primary" onClick={runDates} disabled={busy || (!expiryInput && !trialInput)}>
              {busy ? 'Guardando…' : 'Guardar fechas'}
            </Button>
          </>
        }
      >
        {dates && (() => {
          const caps = capsOf(dates.row)
          const moved = expiryInput && expiryInput !== toDayInput(dates.row.current_period_end)
          const d = expiryInput ? daysUntil(`${expiryInput}T23:59:59Z`) : null
          return (
            <>
              {caps?.hasExpiry && (
                <Field label="Vence el" hint={`hoy: ${fmtDate(dates.row.current_period_end)}`} htmlFor="lic-expiry">
                  <TextInput id="lic-expiry" type="date" value={expiryInput} onChange={(e) => setExpiryInput(e.target.value)} />
                </Field>
              )}
              {caps?.hasTrial && (
                <Field label="Fin de la prueba" hint={`hoy: ${fmtDate(dates.row.trial_ends_at)}`} htmlFor="lic-trial">
                  <TextInput id="lic-trial" type="date" value={trialInput} onChange={(e) => setTrialInput(e.target.value)} />
                </Field>
              )}
              <label className="mt-4 flex items-start gap-2 text-sm text-ink-soft">
                <input type="checkbox" checked={alsoActivate} onChange={(e) => setAlsoActivate(e.target.checked)} className="mt-0.5 accent-brand" />
                <span>Reactivar la licencia junto con la fecha nueva.</span>
              </label>
              <div className="mt-4">
                <Callout tone={moved && d != null && d < 0 ? 'warn' : 'neutral'}>
                  {moved && d != null && d < 0
                    ? 'Esa fecha ya pasó: el tenant queda vencido y el cron empezará a restringirlo en su siguiente corrida.'
                    : 'La fecha se escribe tal cual, sin cobrar nada y sin sumar al período anterior. Sirve para prórrogas, cortesías o corregir una captura.'}
                </Callout>
              </div>
              <p className="mt-3 text-xs text-ink-faint">La licencia es válida durante todo el día elegido.</p>
            </>
          )
        })()}
      </Modal>

      {/* ── Dar de baja ── */}
      <Modal
        open={!!cancel} busy={busy} onClose={() => setCancel(null)} tone="danger"
        title="Dar de baja la licencia"
        subtitle={cancel && <>{cancel.row.apps?.name ?? cancel.row.app_id} · <span className="font-medium text-ink">{nameOf(cancel.row)}</span></>}
        footer={
          <>
            <Button onClick={() => setCancel(null)} disabled={busy}>Cancelar</Button>
            <Button variant="danger" onClick={runCancel} disabled={busy || typed !== nameOf(cancel?.row ?? {})}>
              {busy ? 'Dando de baja…' : 'Dar de baja'}
            </Button>
          </>
        }
      >
        {cancel && (
          <>
            <Callout tone="danger">
              <span className="font-semibold">Pasan dos cosas:</span>
              <ol className="mt-1 list-decimal space-y-0.5 pl-4">
                <li>En la app, la licencia queda en <span className="font-mono">{capsOf(cancel.row)?.statuses.cancel ?? 'suspendida'}</span> y vence hoy — el tenant pierde el acceso.</li>
                <li>El renglón sale de esta lista y se guarda en “Dadas de baja”.</li>
              </ol>
            </Callout>
            <p className="mt-3 text-sm text-ink-soft">
              No se borra información del tenant. Puedes restaurar el renglón y reactivar la licencia cuando quieras.
            </p>
            <Field label="Motivo" hint="opcional — queda en la bitácora">
              <TextInput value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Dejó de pagar / cambió de proveedor…" />
            </Field>
            <Field label="Confírmalo escribiendo el nombre" hint={nameOf(cancel.row)}>
              <TextInput value={typed} onChange={(e) => setTyped(e.target.value)} />
            </Field>
          </>
        )}
      </Modal>

      {/* ── Quitar / borrar el renglón (solo bodega) ── */}
      <Modal
        open={!!purge} busy={busy} onClose={() => setPurge(null)} tone="danger"
        title={purge?.archiveOnly ? 'Quitar del panel' : 'Borrar el renglón'}
        subtitle={purge && <>{purge.row.apps?.name ?? purge.row.app_id} · <span className="font-medium text-ink">{nameOf(purge.row)}</span></>}
        footer={
          <>
            <Button onClick={() => setPurge(null)} disabled={busy}>Cancelar</Button>
            <Button variant="danger" onClick={() => runRecord(purge.row, purge.archiveOnly ? 'archive' : 'purge')}
              disabled={busy || (!purge?.archiveOnly && typed !== nameOf(purge?.row ?? {}))}>
              {busy ? 'Aplicando…' : (purge?.archiveOnly ? 'Quitar del panel' : 'Borrar renglón')}
            </Button>
          </>
        }
      >
        {purge && (
          <>
            <Callout tone="warn">
              Esto <span className="font-semibold">no toca la app</span>: solo cambia lo que ves aquí. Para cortarle el acceso al
              tenant usa “Dar de baja”.
            </Callout>
            <p className="mt-3 text-sm text-ink-soft">
              {purge.archiveOnly
                ? 'La licencia sale de la lista y queda en “Dadas de baja”, de donde puedes restaurarla.'
                : 'Se borra el registro de la bodega. Si la licencia sigue viva en la app, el próximo sync la traerá de vuelta — es lo correcto: la app es la fuente de verdad.'}
            </p>
            {!purge.archiveOnly && (
              <Field label="Confírmalo escribiendo el nombre" hint={nameOf(purge.row)}>
                <TextInput value={typed} onChange={(e) => setTyped(e.target.value)} />
              </Field>
            )}
          </>
        )}
      </Modal>

      {/* ── Borrado de datos Premium (CateqHub) ── */}
      <Modal
        open={!!del} busy={busy} onClose={() => setDel(null)} tone="danger"
        title="Borrar datos Premium"
        subtitle={del && <>{del.row.apps?.name ?? del.row.app_id} · <span className="font-medium text-ink">{nameOf(del.row)}</span></>}
        footer={
          <>
            <Button onClick={() => setDel(null)} disabled={busy}>Cancelar</Button>
            <Button variant="danger" onClick={runDeletePremium} disabled={busy || typed !== del?.row.tenants?.name}>
              {busy ? 'Borrando…' : 'Borrar datos Premium'}
            </Button>
          </>
        }
      >
        {del && (
          <>
            <Callout tone="danger">
              Borra para siempre los Tutores y sus vínculos con los niños de esta parroquia. Los niños, los grupos y la
              asistencia no se tocan. No se puede deshacer.
            </Callout>
            <Field label="Confírmalo escribiendo el nombre" hint={del.row.tenants?.name}>
              <TextInput value={typed} onChange={(e) => setTyped(e.target.value)} />
            </Field>
          </>
        )}
      </Modal>

      <ToastStack toasts={toasts} onDismiss={dismiss} />
    </div>
  )
}

// Add-ons del plan de cobro de CateqHub: implementación asistida y soporte
// prioritario. Se confirman aquí porque el pago se valida a mano (WhatsApp o
// factura), sin Mercado Pago de por medio.
function CateqhubAddons({ r, onAddon }) {
  const impl = r.raw?.implementation_status || 'none'
  const tier = r.raw?.implementation_requested_tier || '—'
  const addonOn = !!r.raw?.support_priority_addon
  return (
    <div className="mt-4">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-ink-mute">Add-ons</div>
      <div className="mt-1.5 flex flex-wrap items-center gap-2">
        <Badge tone={impl === 'completed' ? 'ok' : impl === 'requested' ? 'warn' : 'neutral'}>
          Implementación: {impl === 'completed' ? 'completada' : impl === 'requested' ? `solicitada (${tier})` : 'sin solicitar'}
        </Badge>
        {impl === 'requested' && (
          <Button size="sm" variant="positive"
            onClick={() => onAddon(r, 'implementation', 'completed', 'Marcar implementación como completada',
              'Marca la implementación asistida como completada. Hazlo cuando ya hayas confirmado el pago único con la parroquia.',
              'Implementación marcada como completada')}>
            Marcar completada
          </Button>
        )}
        <Toggle
          checked={addonOn} label={`Soporte prioritario: ${addonOn ? 'activo' : 'inactivo'}`}
          onChange={() => onAddon(r, 'support_priority', !addonOn,
            addonOn ? 'Desactivar soporte prioritario' : 'Activar soporte prioritario',
            addonOn
              ? 'La parroquia vuelve al tope de prioridad normal de su plan.'
              : 'Sube el tope de prioridad de ticket a “urgente”. Actívalo solo después de confirmar el pago mensual del add-on.',
            addonOn ? 'Soporte prioritario desactivado' : 'Soporte prioritario activado')}
        />
      </div>
    </div>
  )
}
