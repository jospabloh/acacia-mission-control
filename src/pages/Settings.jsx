import { useEffect, useState, useCallback } from 'react'
import { PageHeader } from '../components/PageHeader.jsx'
import { useAuth } from '../lib/auth/useAuth.js'
import { listMembers, inviteMember, setMemberRole, removeMember } from '../lib/control.js'

const ROLE_STYLE = {
  owner: 'bg-brand/10 text-brand',
  admin: 'bg-violet-50 text-violet-700',
  viewer: 'bg-paper-subtle text-ink-mute',
}
const ROLES = ['owner', 'admin', 'viewer']
const ROLE_HELP = {
  owner: 'Control total: operadores y zona de peligro.',
  admin: 'Lee todo y opera (licencias, soporte, comunicados). No gestiona operadores.',
  viewer: 'Solo lectura en todo el panel.',
}

export function Settings() {
  const { user } = useAuth()
  const [members, setMembers] = useState(null)
  const [flash, setFlash] = useState(null)
  const [busyId, setBusyId] = useState(null) // user_id with an in-flight mutation

  // Invite form
  const [email, setEmail] = useState('')
  const [role, setRole] = useState('admin')
  const [inviting, setInviting] = useState(false)

  const load = useCallback(async () => {
    try {
      const { members: rows } = await listMembers()
      setMembers(rows ?? [])
    } catch (e) { setFlash({ ok: false, msg: e.message }); setMembers([]) }
  }, [])

  useEffect(() => { load() }, [load])

  const ownerCount = (members ?? []).filter((m) => m.role === 'owner').length

  async function onInvite(e) {
    e.preventDefault()
    const addr = email.trim().toLowerCase()
    if (!addr.includes('@')) { setFlash({ ok: false, msg: 'Correo inválido.' }); return }
    setInviting(true); setFlash(null)
    try {
      const r = await inviteMember(addr, role)
      await load()
      setEmail('')
      setFlash({ ok: true, msg: r.invited ? `Invitación enviada a ${addr} como ${role}.` : `${addr} ya tenía cuenta — acceso concedido como ${role}.` })
    } catch (e) { setFlash({ ok: false, msg: e.message }) } finally { setInviting(false) }
  }

  async function onChangeRole(m, nextRole) {
    if (nextRole === m.role) return
    setBusyId(m.user_id); setFlash(null)
    try {
      await setMemberRole(m.user_id, nextRole)
      await load()
      setFlash({ ok: true, msg: `${m.email} ahora es ${nextRole}.` })
    } catch (e) { setFlash({ ok: false, msg: e.message }); await load() } finally { setBusyId(null) }
  }

  async function onRemove(m) {
    if (!window.confirm(`¿Quitar a ${m.email} de Mission Control? Perderá todo acceso de operador (su cuenta de login se conserva).`)) return
    setBusyId(m.user_id); setFlash(null)
    try {
      await removeMember(m.user_id)
      await load()
      setFlash({ ok: true, msg: `${m.email} fue removido.` })
    } catch (e) { setFlash({ ok: false, msg: e.message }) } finally { setBusyId(null) }
  }

  return (
    <div>
      <PageHeader title="Ajustes" subtitle="Operadores y roles de Mission Control. Solo el owner gestiona aquí." />

      {flash && (
        <p className={`mb-4 text-sm ${flash.ok ? 'text-emerald-700' : 'text-red-600'}`}>{flash.msg}</p>
      )}

      {/* Invitar */}
      <h2 className="mb-3 font-display text-sm font-semibold uppercase tracking-wide text-ink-mute">Invitar operador</h2>
      <form onSubmit={onInvite} className="mb-8 flex flex-wrap items-end gap-3 rounded-xl border border-hair bg-paper-card p-4">
        <label className="flex-1 min-w-[220px]">
          <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-ink-mute">Correo</span>
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="persona@acaciaco.com.mx"
            className="w-full rounded-lg border border-hair bg-paper px-3 py-2 text-sm text-ink outline-none focus:border-brand" />
        </label>
        <label>
          <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-ink-mute">Rol</span>
          <select value={role} onChange={(e) => setRole(e.target.value)}
            className="rounded-lg border border-hair bg-paper px-3 py-2 text-sm text-ink outline-none focus:border-brand">
            {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
        </label>
        <button type="submit" disabled={inviting}
          className="inline-flex items-center gap-2 rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50">
          {inviting && <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/60 border-t-transparent" />}
          {inviting ? 'Invitando…' : 'Invitar'}
        </button>
        <p className="w-full text-xs text-ink-faint">{ROLE_HELP[role]}</p>
      </form>

      {/* Operadores */}
      <h2 className="mb-3 font-display text-sm font-semibold uppercase tracking-wide text-ink-mute">
        Operadores {members && <span className="text-ink-faint">· {members.length}</span>}
      </h2>
      <div className="overflow-hidden rounded-xl border border-hair bg-paper-card">
        {members === null ? (
          <p className="px-4 py-4 text-sm text-ink-mute">Cargando…</p>
        ) : members.length === 0 ? (
          <p className="px-4 py-4 text-sm text-ink-mute">Sin operadores.</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="border-b border-hair text-left text-xs uppercase tracking-wide text-ink-mute">
              <tr>
                <th className="px-4 py-3">Correo</th>
                <th className="px-4 py-3">Rol</th>
                <th className="px-4 py-3">Desde</th>
                <th className="px-4 py-3 text-right">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {members.map((m) => {
                const isSelf = m.user_id === user?.id
                const isLastOwner = m.role === 'owner' && ownerCount <= 1
                const busy = busyId === m.user_id
                return (
                  <tr key={m.user_id} className="border-b border-hair last:border-0">
                    <td className="px-4 py-3 font-medium text-ink">
                      {m.email}
                      {isSelf && <span className="ml-2 rounded bg-paper-subtle px-1.5 py-0.5 text-[10px] font-medium text-ink-mute">tú</span>}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`rounded-md px-2 py-0.5 text-xs font-medium ${ROLE_STYLE[m.role]}`}>{m.role}</span>
                    </td>
                    <td className="px-4 py-3 text-ink-soft">{new Date(m.created_at).toLocaleDateString('es-MX')}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-2">
                        <select
                          value={m.role}
                          disabled={busy || isLastOwner}
                          title={isLastOwner ? 'No puedes cambiar el rol del único owner' : 'Cambiar rol'}
                          onChange={(e) => onChangeRole(m, e.target.value)}
                          className="rounded-lg border border-hair bg-paper px-2 py-1 text-xs text-ink outline-none focus:border-brand disabled:opacity-50">
                          {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
                        </select>
                        <button
                          onClick={() => onRemove(m)}
                          disabled={busy || isLastOwner}
                          title={isLastOwner ? 'No puedes quitar al único owner' : 'Quitar operador'}
                          className="rounded-lg border border-red-200 px-2.5 py-1 text-xs font-medium text-red-600 hover:bg-red-50 disabled:opacity-40 disabled:hover:bg-transparent">
                          Quitar
                        </button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>
      <p className="mt-3 text-xs text-ink-faint">
        Las invitaciones crean (o vinculan) una cuenta de acceso y envían un correo de Supabase. Toda alta, cambio de rol o
        baja queda registrada en <span className="font-medium text-ink">Control</span> (auditoría).
      </p>
    </div>
  )
}
