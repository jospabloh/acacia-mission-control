import { useEffect, useState, useCallback, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase.js'
import { revokeSessions } from '../lib/control.js'
import { isRowOpen, isRowOnline, fmtIdle } from '../lib/sessionsView.js'
import { PageHeader, EmptyState } from '../components/PageHeader.jsx'

// Portfolio-wide open sessions (all apps), from the synced bodega copy.
// Read-only view + a quick "cerrar" for idle sessions; forcing an ACTIVE
// session closed is an owner-only action that stays on each app's detail page
// (/apps/:appId), where the operator sees the full per-user context.
export function Sessions() {
  const [rows, setRows] = useState(null) // null = loading
  const [busy, setBusy] = useState(null) // row id being closed
  const [flash, setFlash] = useState(null)
  const [appFilter, setAppFilter] = useState('all')
  const [userFilter, setUserFilter] = useState('all')

  const load = useCallback(async () => {
    const { data, error } = await supabase.from('app_sessions')
      .select('id, app_id, external_id, user_email, user_name, device, last_active_at, revoked_at, apps(id, name)')
      .order('last_active_at', { ascending: false })
    if (error) console.error(error.message)
    const now = Date.now()
    setRows((data ?? []).filter((r) => isRowOpen(r, now)))
  }, [])

  useEffect(() => { load() }, [load])

  async function close(row) {
    setBusy(row.id); setFlash(null)
    try {
      await revokeSessions(row.app_id, { scope: 'session', ids: [row.external_id] })
      await load()
      setFlash({ ok: true, msg: 'Sesión cerrada · sale en ~1 min.' })
    } catch (e) {
      setFlash({ ok: false, msg: e.message })
    } finally { setBusy(null) }
  }

  const now = Date.now()

  // Options are derived from whatever's actually in the list, so the filters
  // never show an app/user with zero open sessions.
  const appOptions = useMemo(() => {
    const m = new Map()
    for (const r of rows ?? []) if (r.app_id) m.set(r.app_id, r.apps?.name ?? r.app_id)
    return [...m.entries()].sort((a, b) => a[1].localeCompare(b[1]))
  }, [rows])
  const userOptions = useMemo(() => {
    const m = new Map()
    for (const r of rows ?? []) {
      const key = r.user_email || r.user_name
      if (key) m.set(key, r.user_name || r.user_email)
    }
    return [...m.entries()].sort((a, b) => a[1].localeCompare(b[1]))
  }, [rows])
  const filtered = (rows ?? []).filter((r) =>
    (appFilter === 'all' || r.app_id === appFilter) &&
    (userFilter === 'all' || r.user_email === userFilter || r.user_name === userFilter))

  return (
    <div>
      <PageHeader title="Sesiones activas" subtitle="Sesiones abiertas de todas las apps del portafolio, en vivo." />

      {flash && <p className={`mb-4 text-sm ${flash.ok ? 'text-emerald-700 dark:text-emerald-300' : 'text-red-600 dark:text-red-400'}`}>{flash.msg}</p>}

      {rows !== null && rows.length > 0 && (
        <div className="mb-4 flex flex-wrap items-center gap-2 text-sm">
          <select value={appFilter} onChange={(e) => setAppFilter(e.target.value)}
            className="rounded-lg border border-hair bg-paper-card px-3 py-1.5 text-ink">
            <option value="all">Todas las apps</option>
            {appOptions.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
          </select>
          <select value={userFilter} onChange={(e) => setUserFilter(e.target.value)}
            className="rounded-lg border border-hair bg-paper-card px-3 py-1.5 text-ink">
            <option value="all">Todos los usuarios</option>
            {userOptions.map(([key, label]) => <option key={key} value={key}>{label}</option>)}
          </select>
          {(appFilter !== 'all' || userFilter !== 'all') && (
            <button onClick={() => { setAppFilter('all'); setUserFilter('all') }}
              className="text-xs font-medium text-ink-mute hover:text-brand">Limpiar filtros</button>
          )}
          <span className="text-ink-faint">{filtered.length} de {rows.length}</span>
        </div>
      )}

      {rows === null ? (
        <p className="text-sm text-ink-mute">Cargando…</p>
      ) : rows.length === 0 ? (
        <EmptyState icon="dashboard" title="Nadie con sesión abierta ahora">
          En cuanto un usuario inicie sesión en alguna app, aparecerá aquí.
        </EmptyState>
      ) : filtered.length === 0 ? (
        <p className="text-sm text-ink-faint">Ningún resultado con esos filtros.</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-hair bg-paper-card">
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase tracking-wide text-ink-mute border-b border-hair">
              <tr>
                <th className="px-4 py-3">App</th><th className="px-4 py-3">Usuario</th>
                <th className="px-4 py-3">Dispositivo</th><th className="px-4 py-3">Estado</th>
                <th className="px-4 py-3">Acción</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => {
                const online = isRowOnline(r, now)
                return (
                  <tr key={r.id} className="border-b border-hair last:border-0">
                    <td className="px-4 py-3 font-medium text-ink">
                      {r.apps?.id ? <Link to={`/apps/${r.apps.id}`} className="hover:text-brand">{r.apps.name}</Link> : (r.apps?.name ?? r.app_id)}
                    </td>
                    <td className="px-4 py-3 text-ink-soft">{r.user_name || r.user_email || '(sin usuario)'}</td>
                    <td className="px-4 py-3 text-ink-faint">{r.device || '—'}</td>
                    <td className="px-4 py-3">
                      {online ? (
                        <span className="inline-flex items-center gap-1.5 rounded-md bg-emerald-50 dark:bg-emerald-950/40 px-2 py-0.5 text-xs font-semibold text-emerald-700 dark:text-emerald-300">
                          <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" /> en línea
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1.5 rounded-md bg-amber-50 dark:bg-amber-950/40 px-2 py-0.5 text-xs font-semibold text-amber-700 dark:text-amber-300">
                          <span className="h-1.5 w-1.5 rounded-full bg-amber-400" /> idle {fmtIdle(Date.now() - Date.parse(r.last_active_at))}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {online ? (
                        <span className="text-xs text-ink-faint">forzar cierre: ir a la app</span>
                      ) : (
                        <button onClick={() => close(r)} disabled={busy === r.id}
                          className="rounded-lg border border-hair bg-paper-card px-2.5 py-1 text-xs font-semibold text-ink hover:border-red-300 dark:border-red-800 hover:bg-red-50 dark:bg-red-950/40 hover:text-red-700 dark:text-red-300 disabled:opacity-50">
                          {busy === r.id ? '…' : 'Cerrar'}
                        </button>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
