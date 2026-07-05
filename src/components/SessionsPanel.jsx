import { useCallback, useEffect, useState } from 'react'
import { appSessions, revokeSessions } from '../lib/control.js'
import { fmtIdle } from '../lib/sessionsView.js'
import { useAuth } from '../lib/auth/useAuth.js'
import { Icon } from './icons.jsx'

// AppDetail section: end-user sessions of one app, LIVE, grouped by user, with
// force-logout. The 30-min rule is enforced server-side; the UI mirrors it so the
// operator sees *why* an active session can't be closed (and, if owner, can force
// it). Only rendered for apps that report sessions (config.session_entity).

function StateBadge({ state }) {
  if (state === 'online') {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-md bg-emerald-50 px-2 py-0.5 text-xs font-semibold text-emerald-700">
        <span className="relative flex h-1.5 w-1.5">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
          <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-500" />
        </span>
        en línea
      </span>
    )
  }
  return <span className="inline-flex items-center gap-1.5 rounded-md bg-amber-50 px-2 py-0.5 text-xs font-semibold text-amber-700"><span className="h-1.5 w-1.5 rounded-full bg-amber-400" /> idle</span>
}

// One session row inside an expanded user.
function SessionRow({ appId, session, isOwner, onChange }) {
  const [busy, setBusy] = useState(false)
  const active = session.state === 'online'

  async function close({ override } = {}) {
    if (override && !window.confirm(`Forzar el cierre de una sesión ACTIVA (${session.device || 'dispositivo'})?\n\nEl usuario será desconectado en su próximo latido (~1 min). Queda auditado.`)) return
    setBusy(true)
    try {
      await revokeSessions(appId, { scope: 'session', ids: [session.external_id], override })
      onChange(override ? 'Sesión activa forzada · sale en ~1 min' : 'Sesión cerrada · sale en ~1 min')
    } catch (e) {
      onChange(e.message, true)
      setBusy(false)
    }
  }

  return (
    <div className="flex items-center gap-3 rounded-lg px-3 py-2.5 hover:bg-paper-subtle/60">
      <div className="flex min-w-0 flex-col">
        <span className="text-sm font-medium text-ink">{session.device || 'Dispositivo desconocido'}</span>
        <span className="text-xs text-ink-mute">
          {session.started_at ? `inició ${new Date(session.started_at).toLocaleString('es-MX', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}` : 'sin fecha de inicio'}
        </span>
      </div>
      <div className="ml-auto flex items-center gap-3">
        <span className="min-w-[92px] text-right text-xs tabular-nums text-ink-soft">
          {active ? <StateBadge state="online" /> : <>idle <span className="font-semibold text-amber-700">{fmtIdle(session.idle_ms)}</span></>}
        </span>
        {active ? (
          isOwner ? (
            <button onClick={() => close({ override: true })} disabled={busy}
              className="rounded-lg border border-red-300 bg-red-50 px-2.5 py-1 text-xs font-semibold text-red-700 hover:bg-red-500 hover:text-white disabled:opacity-50">
              {busy ? '…' : 'Forzar cierre'}
            </button>
          ) : (
            <button disabled title="Sesión activa: debe estar 30 min idle, o forzarla el owner"
              className="cursor-not-allowed rounded-lg border border-hair bg-paper-subtle px-2.5 py-1 text-xs font-semibold text-ink-faint">
              Cerrar
            </button>
          )
        ) : (
          <button onClick={() => close()} disabled={busy}
            className="rounded-lg border border-hair bg-paper-card px-2.5 py-1 text-xs font-semibold text-ink hover:border-red-300 hover:bg-red-50 hover:text-red-700 disabled:opacity-50">
            {busy ? '…' : 'Cerrar'}
          </button>
        )}
      </div>
    </div>
  )
}

// One user group (collapsed → header only; expanded → its sessions + bulk).
function UserRow({ appId, user, isOwner, onChange }) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const idleCount = user.idle
  const activeCount = user.online

  async function closeIdle() {
    if (idleCount === 0) return
    setBusy(true)
    try {
      const r = await revokeSessions(appId, { scope: 'user-idle', userEmail: user.user_email })
      const skipped = r.skipped_active ? ` · ${r.skipped_active} activa${r.skipped_active === 1 ? '' : 's'} se mantiene${r.skipped_active === 1 ? '' : 'n'}` : ''
      onChange(`${r.revoked} sesión${r.revoked === 1 ? '' : 'es'} idle cerrada${r.revoked === 1 ? '' : 's'}${skipped}`)
    } catch (e) {
      onChange(e.message, true)
      setBusy(false)
    }
  }

  return (
    <div className="border-b border-hair last:border-0">
      <button onClick={() => setOpen((v) => !v)} aria-expanded={open}
        className="group flex w-full items-center gap-3 py-3 text-left hover:bg-paper-subtle/40">
        <span aria-hidden className={`w-3 text-ink-faint transition-transform ${open ? 'rotate-90' : ''}`}>›</span>
        <span className="grid h-8 w-8 flex-none place-items-center rounded-lg bg-brand/10 font-display text-xs font-semibold text-brand-deep">
          {(user.user_name || user.user_email || '?').slice(0, 2).toUpperCase()}
        </span>
        <span className="flex min-w-0 flex-col">
          <span className="truncate text-sm font-semibold text-ink">{user.user_name || user.user_email || '(sin usuario)'}</span>
          {user.user_name && <span className="truncate text-xs text-ink-mute">{user.user_email}</span>}
        </span>
        <span className="ml-auto flex items-center gap-3">
          {activeCount > 0
            ? <span className="inline-flex items-center gap-1.5 rounded-md bg-emerald-50 px-2 py-0.5 text-xs font-semibold text-emerald-700"><span className="h-1.5 w-1.5 rounded-full bg-emerald-500" /> {activeCount} en línea</span>
            : <span className="inline-flex items-center gap-1.5 rounded-md bg-amber-50 px-2 py-0.5 text-xs font-semibold text-amber-700"><span className="h-1.5 w-1.5 rounded-full bg-amber-400" /> {idleCount} idle</span>}
          <span className="text-xs text-ink-mute"><span className="font-display font-semibold text-ink">{user.sessions.length}</span> {user.sessions.length === 1 ? 'sesión' : 'sesiones'}</span>
        </span>
      </button>
      {open && (
        <div className="pb-3 pl-8 pr-1">
          <div className="flex flex-col gap-0.5">
            {user.sessions.map((s) => (
              <SessionRow key={s.external_id} appId={appId} session={s} isOwner={isOwner} onChange={onChange} />
            ))}
          </div>
          <div className="mt-2 flex items-center gap-3 rounded-lg bg-paper-subtle px-3 py-2.5">
            <span className="text-xs text-ink-mute">
              <span className="font-semibold text-ink">{idleCount}</span> idle cerrable{idleCount === 1 ? '' : 's'}
              {activeCount > 0 && <> · <span className="font-semibold text-ink">{activeCount}</span> activa{activeCount === 1 ? '' : 's'} se mantiene{activeCount === 1 ? '' : 'n'}</>}
            </span>
            <button onClick={closeIdle} disabled={busy || idleCount === 0}
              className="ml-auto rounded-lg bg-ink px-2.5 py-1 text-xs font-semibold text-paper hover:bg-brand-deep disabled:cursor-not-allowed disabled:opacity-40">
              {busy ? '…' : `Cerrar sesiones idle (${idleCount})`}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

export function SessionsPanel({ appId, supported }) {
  const { role } = useAuth()
  const isOwner = role === 'owner'
  const [data, setData] = useState(null) // { totals, users, fetched_at }
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(false)
  const [flash, setFlash] = useState(null) // { msg, bad }

  const load = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      setData(await appSessions(appId))
    } catch (e) {
      setError(e.message)
    } finally { setLoading(false) }
  }, [appId])

  useEffect(() => { if (supported) load() }, [supported, load])

  function onChange(msg, bad = false) {
    setFlash({ msg, bad })
    if (!bad) load()
    window.clearTimeout(onChange._t)
    onChange._t = window.setTimeout(() => setFlash(null), 4000)
  }

  if (!supported) return null

  const t = data?.totals

  return (
    <div className="mt-6 rounded-xl border border-hair bg-paper-card p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="font-display text-sm font-semibold uppercase tracking-wide text-ink-mute">Sesiones activas</h3>
          <div className="mt-1.5 flex items-center gap-3">
            <span className="font-display text-2xl font-semibold text-ink tabular-nums">{t?.open ?? '—'}</span>
            {t && (
              <span className="flex items-center gap-2 text-sm text-ink-soft">
                <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-emerald-500" /> {t.online} en línea</span>
                <span className="text-ink-faint">·</span>
                <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-amber-400" /> {t.idle} idle</span>
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-3">
          {data?.fetched_at && <span className="text-xs text-ink-faint">actualizado {new Date(data.fetched_at).toLocaleTimeString('es-MX')}</span>}
          <button onClick={load} disabled={loading}
            className="inline-flex items-center gap-1.5 rounded-lg border border-hair px-3 py-1.5 text-sm font-medium text-ink hover:border-brand/40 hover:text-brand disabled:opacity-50">
            <span className={loading ? 'animate-spin' : ''}>↻</span> {loading ? 'Cargando…' : 'Refrescar'}
          </button>
        </div>
      </div>

      <div className="mt-4 flex items-start gap-2.5 rounded-lg border border-brand/20 bg-brand/[0.06] px-3.5 py-3 text-xs text-ink-soft">
        <Icon name="control" size={15} className="mt-px flex-none text-brand" />
        <p>
          Cerrar una sesión obliga al usuario a volver a iniciar sesión (sale en su próximo latido, ~1 min). La acción masiva
          cierra <span className="font-semibold text-ink">solo sesiones inactivas ≥ 30 min</span>. Una sesión activa está protegida
          {isOwner ? <> — como <span className="font-semibold text-ink">owner</span> puedes forzarla con confirmación.</> : <> y solo el <span className="font-semibold text-ink">owner</span> puede forzarla.</>}
        </p>
      </div>

      {flash && <p className={`mt-3 text-sm ${flash.bad ? 'text-red-600' : 'text-emerald-700'}`}>{flash.msg}</p>}
      {error && <p className="mt-3 text-sm text-red-600">No se pudo leer las sesiones: {error}</p>}

      {data && (
        <div className="mt-4 border-t border-hair">
          {data.users.length === 0 && <p className="py-6 text-sm text-ink-faint">Nadie con sesión abierta ahora. 🌙</p>}
          {data.users.map((u) => (
            <UserRow key={u.user_email || '(anon)'} appId={appId} user={u} isOwner={isOwner} onChange={onChange} />
          ))}
        </div>
      )}
    </div>
  )
}
