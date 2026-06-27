import { useEffect, useState, useCallback } from 'react'
import { supabase } from '../lib/supabase.js'
import { PageHeader, EmptyState } from '../components/PageHeader.jsx'

// Every write Mission Control performs calls audit() into public.audit_actions.
// This is the read-only trail of those operations — who did what, to which app,
// when. Read access is admin+ (bodega RLS). No writes happen here.
const ACTION_META = {
  'control:license-action': { label: 'Licencia', cls: 'bg-violet-50 text-violet-700' },
  'control:ticket-action': { label: 'Ticket', cls: 'bg-sky-50 text-sky-700' },
  'control:send-message': { label: 'Comunicado', cls: 'bg-amber-50 text-amber-700' },
  'control:run-sync': { label: 'Sync manual', cls: 'bg-emerald-50 text-emerald-700' },
  'control:member-invite': { label: 'Operador +', cls: 'bg-brand/10 text-brand' },
  'control:member-role': { label: 'Operador rol', cls: 'bg-brand/10 text-brand' },
  'control:member-remove': { label: 'Operador −', cls: 'bg-red-50 text-red-600' },
  sync: { label: 'Cron', cls: 'bg-paper-subtle text-ink-mute' },
  'sync-licenses': { label: 'Cron licencias', cls: 'bg-paper-subtle text-ink-mute' },
  'sync-usage': { label: 'Cron uso', cls: 'bg-paper-subtle text-ink-mute' },
}
const meta = (a) => ACTION_META[a] ?? { label: a, cls: 'bg-paper-subtle text-ink-mute' }
const isControl = (a) => a?.startsWith('control:')

function fmt(v) {
  if (!v) return '—'
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString('es-MX', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
}
// One-line human summary of the payload for the common control actions.
function summarize(r) {
  const p = r.payload ?? {}
  if (r.action === 'control:license-action') return `${p.label ?? p.op ?? 'cambio'}${p.plan ? ` → ${p.plan}` : ''}${p.newExpiry ? ` · vence ${new Date(p.newExpiry).toLocaleDateString('es-MX')}` : ''}`
  if (r.action === 'control:ticket-action') return p.op === 'reply' ? 'respuesta' : `estado → ${p.status ?? ''}`
  if (r.action === 'control:send-message') return `${p.type ?? 'mensaje'} · ${p.sent ?? p.recipients ?? '?'} destinatario(s)`
  if (r.action === 'control:run-sync') return (p.kinds ?? []).join(', ') || 'sync'
  if (r.action === 'control:member-invite') return `${p.email ?? ''} → ${p.role ?? ''}${p.invited ? ' · invitado' : ' · acceso'}`
  if (r.action === 'control:member-role') return `${p.email ?? ''}: ${p.from ?? ''} → ${p.to ?? ''}`
  if (r.action === 'control:member-remove') return `${p.email ?? ''} (${p.role ?? ''}) removido`
  if (r.action === 'sync' || r.action?.startsWith('sync-')) return `${p.apps ?? (p.summary?.length ?? '')} apps`
  return ''
}

export function WriteControl() {
  const [rows, setRows] = useState(null)
  const [onlyControl, setOnlyControl] = useState(true)
  const [appFilter, setAppFilter] = useState('all')
  const [open, setOpen] = useState(null) // expanded row id

  const load = useCallback(() => {
    return supabase.from('audit_actions')
      .select('id, actor_email, action, target_app, target_type, target_id, payload, created_at')
      .order('created_at', { ascending: false }).limit(300)
      .then(({ data, error }) => { if (error) console.error(error.message); setRows(data ?? []) })
  }, [])
  useEffect(() => { load() }, [load])

  const apps = [...new Set((rows ?? []).map((r) => r.target_app).filter(Boolean))].sort()
  const visible = (rows ?? []).filter((r) =>
    (!onlyControl || isControl(r.action)) && (appFilter === 'all' || r.target_app === appFilter))

  return (
    <div>
      <PageHeader title="Control de escritura" subtitle="Auditoría de toda operación que Mission Control ejecuta sobre las apps — quién, qué, cuándo.">
        <button onClick={load} className="rounded-lg border border-hair px-3 py-1.5 text-sm font-medium text-ink hover:bg-paper-subtle">Actualizar</button>
      </PageHeader>

      <div className="mb-4 flex flex-wrap items-center gap-2 text-sm">
        <label className="flex items-center gap-2 text-ink-soft">
          <input type="checkbox" checked={onlyControl} onChange={(e) => setOnlyControl(e.target.checked)} className="accent-brand" />
          Solo acciones de control (ocultar crons)
        </label>
        <select value={appFilter} onChange={(e) => setAppFilter(e.target.value)} className="rounded-lg border border-hair bg-white px-3 py-1.5">
          <option value="all">Todas las apps</option>
          {apps.map((a) => <option key={a} value={a}>{a}</option>)}
        </select>
        {rows && <span className="text-ink-faint">{visible.length} evento(s)</span>}
      </div>

      {rows === null ? (
        <p className="text-sm text-ink-mute">Cargando…</p>
      ) : visible.length === 0 ? (
        <EmptyState icon="control" title="Sin operaciones registradas">
          Cada acción de control (licencias, tickets, comunicados, sync) se registra aquí con su autor y detalle.
        </EmptyState>
      ) : (
        <div className="overflow-hidden rounded-xl border border-hair bg-paper-card divide-y divide-hair">
          {visible.map((r) => (
            <div key={r.id}>
              <button onClick={() => setOpen(open === r.id ? null : r.id)} className="block w-full px-4 py-3 text-left hover:bg-paper-subtle">
                <div className="flex items-center gap-2">
                  <span className={`shrink-0 rounded-md px-2 py-0.5 text-[11px] font-medium ${meta(r.action).cls}`}>{meta(r.action).label}</span>
                  {r.target_app && <span className="shrink-0 text-xs font-medium text-ink-mute">{r.target_app}</span>}
                  <span className="truncate text-sm text-ink-soft">{summarize(r)}</span>
                  <span className="ml-auto shrink-0 text-xs text-ink-faint">{fmt(r.created_at)}</span>
                </div>
                <div className="mt-0.5 text-[11px] text-ink-faint">
                  {r.actor_email || 'sistema / cron'}{r.target_id ? ` · ${r.target_id}` : ''}
                </div>
              </button>
              {open === r.id && (
                <pre className="overflow-x-auto bg-paper-subtle px-4 py-3 text-[11px] text-ink-soft">{JSON.stringify(r.payload ?? {}, null, 2)}</pre>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
