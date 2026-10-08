import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase.js'
import { testimonialReview } from '../lib/control.js'
import { useToasts } from '../lib/useToasts.js'
import { PageHeader, EmptyState } from '../components/PageHeader.jsx'
import { Button, Badge, FilterChips, ToastStack } from '../components/ui.jsx'

// Tab → statuses it shows. Withdrawn ones are the person's own decision and are
// never offered for review, so they have no tab.
const TABS = [
  { value: 'pending', label: 'Pendientes' },
  { value: 'approved', label: 'Aprobados' },
  { value: 'rejected', label: 'Rechazados' },
]

function fmtDate(v) {
  const d = v ? new Date(v) : null
  return d && !Number.isNaN(d.getTime()) ? d.toLocaleDateString('es-MX', { day: 'numeric', month: 'short', year: 'numeric' }) : '—'
}

function Stars({ n }) {
  return <span className="text-amber-500" title={`${n} de 5`} aria-label={`${n} de 5 estrellas`}>{'★'.repeat(n)}<span className="text-ink-faint">{'★'.repeat(5 - n)}</span></span>
}

const PAGE = 50
const COLS = 'id, app_id, tenant_external_id, rating, body, author_name, author_role, status, submitted_at, reviewed_at, reviewed_by, updated_at, apps(name)'

// The business name is not stored on the testimonial (it would go stale and is
// personal data that a withdrawal would have to chase): resolve it at display
// time from `tenants`, which the tenant sync keeps current.
async function resolveNames(rows) {
  const ids = [...new Set(rows.map((r) => r.tenant_external_id).filter(Boolean))]
  if (!ids.length) return {}
  const { data } = await supabase.from('tenants').select('app_id, external_id, name').in('external_id', ids)
  return Object.fromEntries((data ?? []).filter((t) => t.name).map((t) => [`${t.app_id}|${t.external_id}`, t.name]))
}

export function Testimonials() {
  const { toasts, ok, fail, dismiss } = useToasts()
  const [rows, setRows] = useState(null) // rows of the CURRENT tab only; null = cargando
  const [counts, setCounts] = useState(null)
  const [more, setMore] = useState(false)
  const [tab, setTab] = useState('pending')
  const [busyId, setBusyId] = useState(null)
  // Only the latest request may write state: switching tabs mid-load, or a
  // reload after a review, must not let an older response resolve last and win.
  const reqId = useRef(0)
  const moreGen = useRef(0) // generation of the in-flight "Cargar más"; a double click or a reload invalidates it
  const [loadingMore, setLoadingMore] = useState(false)
  const [names, setNames] = useState({}) // `${app_id}|${tenant_external_id}` → business name, resolved from `tenants`
  const tabRef = useRef('pending') // the tab on screen NOW (decide() may finish after a tab switch)

  // One query per tab (status filter in the DB, never a client-side filter over
  // a capped result), paged with "Cargar más"; counts come from head queries, so
  // they stay right past the API's row cap. Order is deterministic (newest
  // first, id tiebreak) so pages never skip or repeat.
  const load = useCallback(async (status, upTo = PAGE) => {
    const mine = ++reqId.current
    const [list, ...cs] = await Promise.all([
      supabase.from('testimonials').select(COLS).eq('status', status)
        .order('submitted_at', { ascending: false, nullsFirst: false }).order('id', { ascending: false }).range(0, upTo - 1),
      ...TABS.map((t) => supabase.from('testimonials').select('id', { count: 'exact', head: true }).eq('status', t.value)),
    ])
    if (mine !== reqId.current) return
    if (list.error || cs.some((c) => c.error)) { console.error((list.error ?? cs.find((c) => c.error).error).message); fail('No se pudieron cargar los testimonios.') }
    const found = await resolveNames(list.data ?? [])
    if (mine !== reqId.current) return
    moreGen.current += 1 // any "Cargar más" started before this reload is stale
    setLoadingMore(false)
    setNames((n) => ({ ...n, ...found }))
    setRows(list.data ?? [])
    setMore((list.data?.length ?? 0) === upTo)
    setCounts(Object.fromEntries(TABS.map((t, i) => [t.value, cs[i].count ?? 0])))
  }, [fail])
  useEffect(() => { tabRef.current = tab; setRows(null); load(tab) }, [load, tab])

  async function loadMore() {
    if (loadingMore || !rows) return
    const mine = reqId.current
    const gen = ++moreGen.current
    setLoadingMore(true)
    const from = rows.length
    const { data, error } = await supabase.from('testimonials').select(COLS).eq('status', tab)
      .order('submitted_at', { ascending: false, nullsFirst: false }).order('id', { ascending: false }).range(from, from + PAGE - 1)
    if (mine !== reqId.current || gen !== moreGen.current) return // another load started meanwhile; its result wins
    setLoadingMore(false)
    if (error) { console.error(error.message); fail('No se pudieron cargar más testimonios.'); return }
    const found = await resolveNames(data ?? [])
    if (mine !== reqId.current || gen !== moreGen.current) return
    setNames((n) => ({ ...n, ...found }))
    // Dedupe by id: belt and braces against a page that overlaps the previous one.
    setRows((r) => { const seen = new Set(r.map((x) => x.id)); return [...r, ...(data ?? []).filter((x) => !seen.has(x.id))] })
    setMore((data?.length ?? 0) === PAGE)
  }
  const shown = rows ?? []

  async function decide(row, op, done) {
    setBusyId(row.id)
    try {
      await testimonialReview(row.id, op, row.updated_at)
      ok(done)
    } catch (e) {
      fail(e.message)
    } finally {
      setBusyId(null)
      await load(tabRef.current, tabRef.current === tab ? Math.max(PAGE, rows?.length ?? PAGE) : PAGE)
    }
  }

  return (
    <div>
      <PageHeader title="Testimonios" subtitle="Lo que dejan los clientes desde Soporte. Solo los aprobados se publican en la web; el texto no se edita." />
      <FilterChips ariaLabel="Estado" value={tab} onChange={setTab}
        options={TABS.map((t) => ({ ...t, count: counts ? counts[t.value] : undefined }))} />

      <div className="mt-4 space-y-3">
        {rows === null && <p className="text-sm text-ink-mute">Cargando…</p>}
        {rows !== null && shown.length === 0 && (
          <EmptyState icon="star" title="Nada por aquí">No hay testimonios en esta pestaña.</EmptyState>
        )}
        {shown.map((r) => (
          <article key={r.id} className="rounded-xl border border-hair bg-paper-card p-5">
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <Badge tone="info">{r.apps?.name ?? r.app_id}</Badge>
              <span className="text-ink-soft">{names[`${r.app_id}|${r.tenant_external_id}`] ?? 'Sin nombre de negocio'}</span>
              <Stars n={r.rating} />
            </div>
            <p className="mt-3 whitespace-pre-wrap text-sm text-ink">{r.body}</p>
            <p className="mt-2 text-sm text-ink-soft">
              — {r.author_name}{r.author_role ? `, ${r.author_role}` : ''}
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <span className="mr-auto text-xs text-ink-faint">
                Enviado {fmtDate(r.submitted_at)}{r.reviewed_at ? ` · Revisado ${fmtDate(r.reviewed_at)}${r.reviewed_by ? ` por ${r.reviewed_by}` : ''}` : ''}
              </span>
              {(r.status === 'pending' || r.status === 'rejected') && (
                <Button variant="positive" size="sm" disabled={busyId === r.id} onClick={() => decide(r, 'approve', 'Testimonio aprobado')}>Aprobar</Button>
              )}
              {r.status === 'pending' && (
                <Button variant="danger-soft" size="sm" disabled={busyId === r.id} onClick={() => decide(r, 'reject', 'Testimonio rechazado')}>Rechazar</Button>
              )}
              {r.status === 'approved' && (
                <Button variant="warn" size="sm" disabled={busyId === r.id} onClick={() => decide(r, 'unpublish', 'Testimonio despublicado')}>Despublicar</Button>
              )}
            </div>
          </article>
        ))}
        {more && rows !== null && <div className="text-center"><Button variant="secondary" size="sm" disabled={loadingMore} onClick={loadMore}>Cargar más</Button></div>}
      </div>
      <ToastStack toasts={toasts} onDismiss={dismiss} />
    </div>
  )
}
