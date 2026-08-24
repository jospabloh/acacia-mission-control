// src/pages/CRM.jsx
import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase.js'
import { PageHeader, StatCard } from '../components/PageHeader.jsx'
import { Badge, FilterChips } from '../components/ui.jsx'
// `type` distinguishes a Soporte a Apps submission (acaciaco-site) from an
// ordinary sales lead (`null` — the table's original and only meaning). The
// vocabulary + its presentation live in one place, drift-guarded against
// api/_lib/leadType.js — see src/lib/leadTypes.js.
import { TYPE_LABEL, TYPE_TONE, TYPE_FILTERS } from '../lib/leadTypes.js'

const PIPELINE = ['new', 'contacted', 'qualified', 'won', 'lost']
const STATUS_LABEL = { new: 'Nuevo', contacted: 'Contactado', qualified: 'Calificado', won: 'Ganado', lost: 'Perdido' }
const STATUS_STYLE = {
  new: 'bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300',
  contacted: 'bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300',
  qualified: 'bg-violet-50 text-violet-700',
  won: 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300',
  lost: 'bg-red-50 dark:bg-red-950/40 text-red-700 dark:text-red-300',
}

export function CRM() {
  const [rows, setRows] = useState(null)
  const [busy, setBusy] = useState(null)
  const [flash, setFlash] = useState(null)
  const [typeFilter, setTypeFilter] = useState('all')

  function load() {
    return supabase.from('leads')
      .select('id, source, name, email, phone, app_interest, message, status, type, created_at')
      .order('created_at', { ascending: false })
      .limit(300)
      .then(({ data, error }) => { if (error) console.error(error.message); setRows(data ?? []) })
  }
  useEffect(() => { load() }, [])

  async function setStatus(id, status) {
    setBusy(id); setFlash(null)
    const { error } = await supabase.from('leads').update({ status }).eq('id', id)
    if (error) setFlash({ ok: false, msg: error.message })
    else setRows((rs) => rs.map((r) => (r.id === id ? { ...r, status } : r)))
    setBusy(null)
  }

  const kpis = useMemo(() => {
    const r = rows ?? []
    const weekAgo = Date.now() - 7 * 86_400_000
    const byStatus = {}
    let fresh = 0
    for (const l of r) {
      byStatus[l.status ?? 'new'] = (byStatus[l.status ?? 'new'] ?? 0) + 1
      if (new Date(l.created_at).getTime() >= weekAgo) fresh++
    }
    return { total: r.length, fresh, won: byStatus.won ?? 0, open: (byStatus.new ?? 0) + (byStatus.contacted ?? 0) + (byStatus.qualified ?? 0), byStatus }
  }, [rows])

  const typeOptions = useMemo(() => {
    const r = rows ?? []
    const counts = { all: r.length, sales: 0, soporte: 0, mejora: 0, idea: 0 }
    for (const l of r) counts[l.type ?? 'sales'] = (counts[l.type ?? 'sales'] ?? 0) + 1
    return TYPE_FILTERS.map((f) => ({ ...f, count: counts[f.value] ?? 0 }))
  }, [rows])

  const filteredRows = useMemo(() => {
    const r = rows ?? []
    if (typeFilter === 'all') return r
    if (typeFilter === 'sales') return r.filter((l) => !l.type)
    return r.filter((l) => l.type === typeFilter)
  }, [rows, typeFilter])

  if (rows === null) return (<div><PageHeader title="CRM" /><p className="text-sm text-ink-mute">Cargando…</p></div>)

  return (
    <div>
      <PageHeader title="CRM" subtitle="Leads del sitio y seguimiento de pipeline." />
      {flash && <p className={`mb-4 text-sm ${flash.ok ? 'text-emerald-700 dark:text-emerald-300' : 'text-red-600 dark:text-red-400'}`}>{flash.msg}</p>}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Leads" value={kpis.total} hint={`${kpis.fresh} nuevos ≤7d`} />
        <StatCard label="Abiertos" value={kpis.open} accent hint="por trabajar" />
        <StatCard label="Ganados" value={kpis.won} />
        <StatCard label="Perdidos" value={kpis.byStatus.lost ?? 0} />
      </div>

      <div className="mt-6">
        <FilterChips options={typeOptions} value={typeFilter} onChange={setTypeFilter} ariaLabel="Filtrar por tipo" />
      </div>

      <div className="mt-3 overflow-x-auto rounded-xl border border-hair bg-paper-card">
        <table className="w-full text-sm">
          <thead className="text-left text-xs uppercase tracking-wide text-ink-mute border-b border-hair">
            <tr>
              <th className="px-4 py-3">Lead</th><th className="px-4 py-3">Interés</th><th className="px-4 py-3">Tipo</th>
              <th className="px-4 py-3">Origen</th><th className="px-4 py-3">Fecha</th><th className="px-4 py-3">Estado</th><th className="px-4 py-3">Mover a</th>
            </tr>
          </thead>
          <tbody>
            {filteredRows.map((r) => (
              <tr key={r.id} className="border-b border-hair last:border-0 align-top">
                <td className="px-4 py-3">
                  <div className="font-medium text-ink">{r.name ?? '—'}</div>
                  <div className="text-xs text-ink-faint">{r.email ?? ''}{r.phone ? ` · ${r.phone}` : ''}</div>
                  {r.message && <div className="mt-1 max-w-xs truncate text-xs text-ink-mute" title={r.message}>{r.message}</div>}
                </td>
                <td className="px-4 py-3 text-ink-soft">{r.app_interest ?? '—'}</td>
                <td className="px-4 py-3">{r.type ? <Badge tone={TYPE_TONE[r.type] ?? 'neutral'}>{TYPE_LABEL[r.type] ?? r.type}</Badge> : <span className="text-ink-faint">Venta</span>}</td>
                <td className="px-4 py-3 text-ink-faint">{r.source ?? '—'}</td>
                <td className="px-4 py-3 text-ink-soft">{r.created_at ? new Date(r.created_at).toLocaleDateString('es-MX') : '—'}</td>
                <td className="px-4 py-3"><span className={`rounded-md px-2 py-0.5 text-xs font-medium ${STATUS_STYLE[r.status] ?? 'bg-paper-subtle text-ink-mute'}`}>{STATUS_LABEL[r.status] ?? r.status ?? '—'}</span></td>
                <td className="px-4 py-3">
                  <select value="" disabled={busy === r.id} onChange={(e) => e.target.value && setStatus(r.id, e.target.value)}
                    className="rounded-md border border-hair bg-paper-card px-2 py-1 text-xs text-ink disabled:opacity-50">
                    <option value="">{busy === r.id ? '…' : 'Cambiar…'}</option>
                    {PIPELINE.filter((s) => s !== r.status).map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
                  </select>
                </td>
              </tr>
            ))}
            {filteredRows.length === 0 && (
              <tr><td colSpan={7} className="px-4 py-4 text-ink-faint">{rows.length === 0 ? <>Sin leads aún. Conecta el formulario de acaciaco.com.mx al endpoint <code className="font-mono text-ink">/api/ingest/lead</code> y entrarán aquí.</> : 'Sin resultados para este filtro.'}</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
