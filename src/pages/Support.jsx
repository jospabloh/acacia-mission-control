import { useEffect, useState, useCallback } from 'react'
import { supabase } from '../lib/supabase.js'
import { runSync, ticketThread, ticketAction } from '../lib/control.js'
import { PageHeader, EmptyState } from '../components/PageHeader.jsx'

// Apps that persist tickets + their valid status values (mirror of
// api/_lib/ticketControl.js). stockflow (email-only) and flowfin (none) are absent.
const TICKET_APPS = [
  { id: 'puntos', name: 'Puntos+' }, { id: 'stockflow', name: 'StockFlow' }, { id: 'flowfin', name: 'FlowFin' },
  { id: 'rumbo', name: 'Rumbo' }, { id: 'liuma', name: 'LIUMA' },
]
const STATUSES = {
  puntos: ['open', 'in_progress', 'waiting_customer', 'resolved', 'closed'],
  stockflow: ['open', 'in_progress', 'waiting_customer', 'resolved', 'closed'],
  flowfin: ['open', 'in_progress', 'waiting_customer', 'resolved', 'closed'],
  rumbo: ['open', 'in_progress', 'resolved', 'closed'],
  liuma: ['OPEN', 'IN_PROGRESS', 'WAITING_USER', 'ESCALATED', 'RESOLVED', 'CLOSED'],
}
// Status → tone, case-insensitive.
const STATUS_TONE = {
  open: 'bg-blue-50 text-blue-700', in_progress: 'bg-amber-50 text-amber-700',
  waiting_user: 'bg-amber-50 text-amber-700', waiting_customer: 'bg-amber-50 text-amber-700',
  escalated: 'bg-red-50 text-red-700', resolved: 'bg-emerald-50 text-emerald-700',
  ai_resolved: 'bg-emerald-50 text-emerald-700', closed: 'bg-paper-subtle text-ink-mute',
}
const PRIO_TONE = {
  urgent: 'text-red-700 font-semibold', high: 'text-amber-700 font-medium',
  normal: 'text-ink-soft', low: 'text-ink-faint',
}
const OPEN_ISH = new Set(['open', 'in_progress', 'waiting_user', 'waiting_customer', 'escalated'])

const tone = (s) => STATUS_TONE[String(s ?? '').toLowerCase()] ?? 'bg-paper-subtle text-ink-mute'
const isOpen = (s) => OPEN_ISH.has(String(s ?? '').toLowerCase())
function fmtWhen(v) {
  if (!v) return '—'
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString('es-MX', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
}

// Compact "time left / overdue" for an SLA deadline, for OPEN tickets only.
// Returns null when the clock doesn't apply (closed ticket / no due time).
function slaBadge(row) {
  if (!isOpen(row.status)) return null
  const due = row.sla_resolve_due_at
  if (!due) return null
  const ms = Date.parse(due) - Date.now()
  if (Number.isNaN(ms)) return null
  const mins = Math.round(Math.abs(ms) / 60000)
  const h = Math.floor(mins / 60)
  const txt = h >= 1 ? `${h}h ${mins % 60}m` : `${mins}m`
  return ms < 0
    ? { label: `SLA vencido ${txt}`, cls: 'bg-red-50 text-red-700' }
    : { label: `SLA ${txt}`, cls: mins <= 120 ? 'bg-amber-50 text-amber-700' : 'bg-paper-subtle text-ink-mute' }
}

// Structured "BA/PO brief" the apps' AI intake assistant attaches to a ticket
// (raw.ai_brief). It turns a raw "no funciona" into a spec a developer can design
// and implement from. Rendered read-only; the same content is also embedded in
// the ticket body as Markdown, so this card is an enhanced view, not the only copy.
function List({ items }) {
  if (!Array.isArray(items) || items.length === 0) return null
  return <ul className="list-disc pl-4 space-y-0.5 text-ink-soft">{items.map((x, i) => <li key={i}>{String(x)}</li>)}</ul>
}
function Field({ label, children }) {
  if (!children || (Array.isArray(children) && children.length === 0)) return null
  return (
    <div>
      <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-faint">{label}</p>
      <div className="mt-0.5 text-ink-soft">{children}</div>
    </div>
  )
}
function AiBrief({ brief }) {
  if (!brief || typeof brief !== 'object') return null
  const isBug = brief.kind === 'bug'
  return (
    <div className="mb-4 rounded-lg border border-brand/20 bg-brand/[0.03] p-3 text-sm">
      <div className="mb-2 flex items-center gap-1.5">
        <span className="rounded bg-brand/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-brand">
          ✦ Brief BA/PO · {isBug ? 'Incidencia' : 'Nueva funcionalidad'}
        </span>
        {brief.severity && <span className="text-[11px] text-ink-faint">Severidad: {brief.severity}</span>}
        {brief.priority_suggestion && <span className="text-[11px] text-ink-faint">· Prioridad sugerida: {brief.priority_suggestion}</span>}
      </div>
      <div className="space-y-2.5">
        {brief.summary && <p className="text-ink-soft">{brief.summary}</p>}
        <Field label="Área / pantalla">{brief.affected_area}</Field>
        {!isBug ? (
          <>
            <Field label="Historia de usuario">{brief.user_story}</Field>
            <Field label="Criterios de aceptación"><List items={brief.acceptance_criteria} /></Field>
            <Field label="Incluye"><List items={brief.scope_in} /></Field>
            <Field label="No incluye"><List items={brief.scope_out} /></Field>
          </>
        ) : (
          <>
            <Field label="Pasos para reproducir"><List items={brief.repro_steps} /></Field>
            <Field label="Esperado">{brief.expected_behavior}</Field>
            <Field label="Actual">{brief.actual_behavior}</Field>
          </>
        )}
        <Field label="Impacto">{brief.impact}</Field>
        <Field label="Preguntas abiertas"><List items={brief.open_questions} /></Field>
      </div>
    </div>
  )
}

export function Support() {
  const [rows, setRows] = useState(null) // null = loading
  const [filterApp, setFilterApp] = useState('all')
  const [onlyOpen, setOnlyOpen] = useState(true)
  const [sel, setSel] = useState(null) // selected ticket row
  const [thread, setThread] = useState(null) // null=loading | []
  const [reply, setReply] = useState('')
  const [busy, setBusy] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [flash, setFlash] = useState(null)

  const load = useCallback(() => {
    return supabase.from('tickets')
      .select('id, app_id, external_id, ticket_number, subject, status, priority, requester, last_activity_at, created_at, customer_created_at, sla_first_response_due_at, sla_resolve_due_at, source, raw, apps(name), tenants(name)')
      .order('last_activity_at', { ascending: false, nullsFirst: false })
      .then(({ data, error }) => { if (error) console.error(error.message); setRows(data ?? []) })
  }, [])
  useEffect(() => { load() }, [load])

  // Real-time: the push ingest (api/ingest/ticket.js) writes a ticket the instant
  // a customer raises it, so subscribe to the bodega and refresh live — no manual
  // "sincronizar". A new INSERT also raises a transient banner.
  useEffect(() => {
    const ch = supabase.channel('tickets-live')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tickets' }, (payload) => {
        load()
        if (payload.eventType === 'INSERT') {
          const t = payload.new
          setFlash({ ok: true, msg: `🎫 Nuevo ticket ${t.ticket_number ? `${t.ticket_number}: ` : ''}${t.subject || t.external_id}` })
        }
      })
      .subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [load])

  const openTicket = useCallback(async (row) => {
    setSel(row); setThread(null); setReply(''); setFlash(null)
    try {
      const out = await ticketThread(row.app_id, row.external_id)
      setThread(out.messages ?? [])
    } catch (e) { setThread([]); setFlash({ ok: false, msg: e.message }) }
  }, [])

  async function sendReply() {
    if (!sel || !reply.trim()) return
    setBusy(true); setFlash(null)
    try {
      await ticketAction(sel.app_id, sel.external_id, 'reply', { body: reply.trim() })
      setReply('')
      await Promise.all([load(), openTicket(sel)])
      setFlash({ ok: true, msg: 'Respuesta enviada.' })
    } catch (e) { setFlash({ ok: false, msg: e.message }) } finally { setBusy(false) }
  }

  async function changeStatus(status) {
    if (!sel || !status) return
    setBusy(true); setFlash(null)
    try {
      await ticketAction(sel.app_id, sel.external_id, 'status', { status })
      await load()
      setSel((s) => (s ? { ...s, status } : s))
      setFlash({ ok: true, msg: `Estado → ${status}.` })
    } catch (e) { setFlash({ ok: false, msg: e.message }) } finally { setBusy(false) }
  }

  async function syncAll() {
    setSyncing(true); setFlash(null)
    try {
      const res = await Promise.allSettled(TICKET_APPS.map((a) => runSync(a.id, ['tickets'])))
      const failed = res.filter((r) => r.status === 'rejected')
      await load()
      setFlash(failed.length
        ? { ok: false, msg: `Sincronización parcial: ${failed.length} app(s) con error.` }
        : { ok: true, msg: 'Tickets sincronizados desde las apps.' })
    } catch (e) { setFlash({ ok: false, msg: e.message }) } finally { setSyncing(false) }
  }

  const visible = (rows ?? []).filter((r) =>
    (filterApp === 'all' || r.app_id === filterApp) && (!onlyOpen || isOpen(r.status)))

  return (
    <div>
      <PageHeader title="Soporte" subtitle="Bandeja unificada de tickets de las 5 apps. Responde y cambia el estado sin entrar a cada una.">
        <button onClick={syncAll} disabled={syncing}
          className="rounded-lg border border-hair px-3 py-1.5 text-sm font-medium text-ink hover:bg-paper-subtle disabled:opacity-50">
          {syncing ? 'Sincronizando…' : 'Sincronizar'}
        </button>
      </PageHeader>

      {flash && <p className={`mb-4 text-sm ${flash.ok ? 'text-emerald-700' : 'text-red-600'}`}>{flash.msg}</p>}

      <div className="mb-4 flex flex-wrap items-center gap-2 text-sm">
        <select value={filterApp} onChange={(e) => setFilterApp(e.target.value)}
          className="rounded-lg border border-hair bg-white px-3 py-1.5">
          <option value="all">Todas las apps</option>
          {TICKET_APPS.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>
        <label className="flex items-center gap-2 text-ink-soft">
          <input type="checkbox" checked={onlyOpen} onChange={(e) => setOnlyOpen(e.target.checked)} className="accent-brand" />
          Solo abiertos
        </label>
        {rows && <span className="text-ink-faint">{visible.length} ticket(s)</span>}
      </div>

      {rows === null ? (
        <p className="text-sm text-ink-mute">Cargando…</p>
      ) : rows.length === 0 ? (
        <EmptyState icon="support" title="Aún no hay tickets sincronizados">
          Pulsa <strong>Sincronizar</strong> para traer los tickets de las apps. (Requiere el puente <code className="font-mono">acaciaControl</code> desplegado.)
        </EmptyState>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
          {/* List */}
          <div className="overflow-y-auto rounded-xl border border-hair bg-paper-card divide-y divide-hair max-h-[70vh]">
            {visible.length === 0 ? (
              <p className="p-4 text-sm text-ink-faint">Sin tickets con estos filtros.</p>
            ) : visible.map((r) => (
              <button key={r.id} onClick={() => openTicket(r)}
                className={`block w-full px-4 py-3 text-left hover:bg-paper-subtle ${sel?.id === r.id ? 'bg-paper-subtle' : ''}`}>
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-sm font-medium text-ink">
                    {r.ticket_number && <span className="mr-1.5 font-mono text-xs font-semibold text-brand">{r.ticket_number}</span>}
                    {r.subject || '(sin asunto)'}
                  </span>
                  <span className={`shrink-0 rounded-md px-2 py-0.5 text-[11px] font-medium ${tone(r.status)}`}>{r.status ?? '—'}</span>
                </div>
                <div className="mt-1 flex items-center gap-2 text-xs text-ink-faint">
                  <span className="font-medium text-ink-mute">{r.apps?.name ?? r.app_id}</span>
                  <span>·</span>
                  <span className="truncate">{r.tenants?.name ?? r.requester?.email ?? r.requester?.name ?? '—'}</span>
                  <span>·</span>
                  <span className={PRIO_TONE[String(r.priority ?? '').toLowerCase()] ?? 'text-ink-faint'}>{r.priority ?? '—'}</span>
                  {(() => { const b = slaBadge(r); return b ? <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${b.cls}`}>{b.label}</span> : null })()}
                  <span className="ml-auto">{fmtWhen(r.last_activity_at || r.created_at)}</span>
                </div>
              </button>
            ))}
          </div>

          {/* Detail */}
          <div className="rounded-xl border border-hair bg-paper-card p-5">
            {!sel ? (
              <p className="text-sm text-ink-faint">Elige un ticket para ver la conversación.</p>
            ) : (
              <>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    {sel.ticket_number && <p className="font-mono text-xs font-semibold text-brand">{sel.ticket_number}</p>}
                    <h3 className="font-display text-base font-semibold text-ink">{sel.subject || '(sin asunto)'}</h3>
                    <p className="mt-0.5 text-xs text-ink-faint">
                      {sel.apps?.name ?? sel.app_id} · {sel.tenants?.name ?? sel.requester?.email ?? sel.requester?.name ?? '—'}
                    </p>
                  </div>
                  <select value="" onChange={(e) => e.target.value && changeStatus(e.target.value)} disabled={busy}
                    className="shrink-0 rounded-md border border-hair bg-white px-2 py-1 text-xs text-ink disabled:opacity-50">
                    <option value="">Estado: {sel.status ?? '—'}…</option>
                    {(STATUSES[sel.app_id] ?? []).filter((s) => s !== sel.status).map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>

                {sel.raw?.ai_brief && <div className="mt-4"><AiBrief brief={sel.raw.ai_brief} /></div>}

                <div className="mt-4 space-y-3 max-h-[44vh] overflow-y-auto pr-1">
                  {thread === null ? (
                    <p className="text-sm text-ink-mute">Cargando conversación…</p>
                  ) : thread.length === 0 ? (
                    <p className="text-sm text-ink-faint">Sin mensajes en el hilo.</p>
                  ) : thread.map((m, i) => (
                    <div key={i} className={`rounded-lg px-3 py-2 text-sm ${m.staff ? 'border border-brand/15 bg-brand/5' : 'bg-paper-subtle'}`}>
                      <div className="mb-0.5 flex items-center justify-between text-[11px] text-ink-faint">
                        <span className="font-medium text-ink-mute">{m.staff ? 'ACACIA' : (m.name || 'Cliente')}</span>
                        <span>{fmtWhen(m.ts)}</span>
                      </div>
                      <p className="whitespace-pre-wrap text-ink-soft">{m.body}</p>
                    </div>
                  ))}
                </div>

                <div className="mt-4 border-t border-hair pt-4">
                  <textarea value={reply} onChange={(e) => setReply(e.target.value)} rows={3} placeholder="Escribe una respuesta como ACACIA Soporte…"
                    className="w-full rounded-lg border border-hair bg-white px-3 py-2 text-sm text-ink placeholder:text-ink-faint" />
                  <div className="mt-2 flex items-center justify-between">
                    <span className="text-xs text-ink-faint">Se envía al cliente vía el puente <code className="font-mono">acaciaControl</code>.</span>
                    <button onClick={sendReply} disabled={busy || !reply.trim()}
                      className="rounded-lg bg-brand px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-deep disabled:opacity-40">
                      {busy ? 'Enviando…' : 'Responder'}
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
