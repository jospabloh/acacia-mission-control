import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase.js'
import { TICKET_CATALOG, isOpenTicket } from '../lib/ticketCatalog.js'

// Open support tickets across every app, on the dashboard. Reads the synced
// bodega (RLS: any member can read), refreshes live like the Support page, and
// sends the operator to Support to act on them. Overdue SLA first.
const MAX_ROWS = 8

function ago(v) {
  const t = Date.parse(v)
  if (Number.isNaN(t)) return ''
  const mins = Math.max(0, Math.round((Date.now() - t) / 60000))
  if (mins < 60) return `hace ${mins} min`
  const h = Math.round(mins / 60)
  if (h < 48) return `hace ${h} h`
  return `hace ${Math.round(h / 24)} días`
}

function overdue(row) {
  const due = Date.parse(row.sla_resolve_due_at)
  return !Number.isNaN(due) && due < Date.now()
}

export function OpenTicketsPanel() {
  const [rows, setRows] = useState(null)
  const [error, setError] = useState(null)

  const load = useCallback(() => supabase.from('tickets')
    .select('id, app_id, ticket_number, subject, status, created_at, customer_created_at, sla_resolve_due_at, apps(name)')
    .order('created_at', { ascending: false })
    .limit(500)
    .then(({ data, error: e }) => {
      if (e) { setError(e.message); setRows([]); return }
      setError(null)
      setRows((data ?? []).filter((r) => isOpenTicket(r.status)))
    }), [])

  useEffect(() => { load() }, [load])
  useEffect(() => {
    const ch = supabase.channel('dashboard-open-tickets')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tickets' }, () => load())
      .subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [load])

  if (rows === null) return null

  const sorted = [...rows].sort((a, b) => (overdue(b) - overdue(a))
    || (Date.parse(b.customer_created_at || b.created_at) - Date.parse(a.customer_created_at || a.created_at)))
  const late = rows.filter(overdue).length

  return (
    <section className="rounded-xl border border-hair bg-paper-card p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-display text-base font-semibold text-ink">
          Tickets abiertos <span className={rows.length ? 'text-brand' : 'text-ink-mute'}>{rows.length}</span>
          {late > 0 && <span className="ml-2 rounded px-1.5 py-0.5 align-middle text-[11px] font-medium bg-red-50 dark:bg-red-950/40 text-red-700 dark:text-red-300">{late} con SLA vencido</span>}
        </h2>
        <Link to="/support" className="text-sm font-medium text-brand hover:underline">Ver en Soporte</Link>
      </div>

      {error && <p className="mt-2 text-sm text-red-600 dark:text-red-400">No se pudieron leer los tickets: {error}</p>}
      {!error && rows.length === 0 && <p className="mt-2 text-sm text-ink-faint">Ninguna app tiene tickets abiertos.</p>}

      {sorted.length > 0 && (
        <ul className="mt-3 divide-y divide-hair">
          {sorted.slice(0, MAX_ROWS).map((r) => (
            <li key={r.id}>
              <Link to="/support" className="flex items-center gap-3 py-2 text-sm hover:bg-paper-subtle">
                <span className="w-24 shrink-0 truncate text-xs font-medium text-ink-mute">{r.apps?.name ?? TICKET_CATALOG[r.app_id]?.name ?? r.app_id}</span>
                <span className="min-w-0 flex-1 truncate text-ink">
                  {r.ticket_number && <span className="mr-1.5 font-mono text-xs font-semibold text-brand">{r.ticket_number}</span>}
                  {r.subject || '(sin asunto)'}
                </span>
                {overdue(r) && <span className="shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium bg-red-50 dark:bg-red-950/40 text-red-700 dark:text-red-300">SLA vencido</span>}
                <span className="hidden shrink-0 text-xs text-ink-faint sm:inline">{ago(r.customer_created_at || r.created_at)}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      {sorted.length > MAX_ROWS && <p className="mt-2 text-xs text-ink-faint">y {sorted.length - MAX_ROWS} más en Soporte.</p>}
    </section>
  )
}
