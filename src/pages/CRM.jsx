import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase.js'
import { PageHeader, EmptyState } from '../components/PageHeader.jsx'

const STATUS_STYLE = {
  new: 'bg-blue-50 text-blue-700',
  contacted: 'bg-amber-50 text-amber-700',
  qualified: 'bg-violet-50 text-violet-700',
  won: 'bg-emerald-50 text-emerald-700',
  lost: 'bg-red-50 text-red-700',
}

export function CRM() {
  const [rows, setRows] = useState(null)

  useEffect(() => {
    supabase.from('leads')
      .select('id, name, email, app_interest, status, created_at')
      .order('created_at', { ascending: false })
      .limit(100)
      .then(({ data, error }) => { if (error) console.error(error.message); setRows(data ?? []) })
  }, [])

  return (
    <div>
      <PageHeader title="CRM" subtitle="Leads del sitio y directorio de tenants." />
      {rows === null ? (
        <p className="text-sm text-ink-mute">Cargando…</p>
      ) : rows.length === 0 ? (
        <EmptyState icon="crm" title="Sin leads todavía" phase={1}>
          Los prospectos del formulario de <code className="font-mono text-ink">acaciaco.com.mx</code>
          {' '}(vía Google Sheets) entrarán aquí para darles seguimiento.
        </EmptyState>
      ) : (
        <div className="overflow-hidden rounded-xl border border-hair bg-paper-card">
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase tracking-wide text-ink-mute border-b border-hair">
              <tr><th className="px-4 py-3">Nombre</th><th className="px-4 py-3">Correo</th><th className="px-4 py-3">Interés</th><th className="px-4 py-3">Estado</th></tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-b border-hair last:border-0">
                  <td className="px-4 py-3 font-medium text-ink">{r.name ?? '—'}</td>
                  <td className="px-4 py-3 text-ink-soft">{r.email ?? '—'}</td>
                  <td className="px-4 py-3 text-ink-soft">{r.app_interest ?? '—'}</td>
                  <td className="px-4 py-3"><span className={`rounded-md px-2 py-0.5 text-xs font-medium ${STATUS_STYLE[r.status] ?? 'bg-paper-subtle text-ink-mute'}`}>{r.status}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
