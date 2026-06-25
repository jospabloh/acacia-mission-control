import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase.js'
import { PageHeader } from '../components/PageHeader.jsx'

const ROLE_STYLE = {
  owner: 'bg-brand/10 text-brand',
  admin: 'bg-violet-50 text-violet-700',
  viewer: 'bg-paper-subtle text-ink-mute',
}

export function Settings() {
  const [members, setMembers] = useState(null)

  useEffect(() => {
    supabase.from('members').select('user_id, email, role, created_at')
      .order('created_at', { ascending: true })
      .then(({ data, error }) => { if (error) console.error(error.message); setMembers(data ?? []) })
  }, [])

  return (
    <div>
      <PageHeader title="Ajustes" subtitle="Operadores, roles y zona de peligro." />

      <h2 className="mb-3 font-display text-sm font-semibold uppercase tracking-wide text-ink-mute">Operadores</h2>
      <div className="overflow-hidden rounded-xl border border-hair bg-paper-card">
        {members === null ? (
          <p className="px-4 py-4 text-sm text-ink-mute">Cargando…</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase tracking-wide text-ink-mute border-b border-hair">
              <tr><th className="px-4 py-3">Correo</th><th className="px-4 py-3">Rol</th><th className="px-4 py-3">Desde</th></tr>
            </thead>
            <tbody>
              {members.map((m) => (
                <tr key={m.user_id} className="border-b border-hair last:border-0">
                  <td className="px-4 py-3 font-medium text-ink">{m.email}</td>
                  <td className="px-4 py-3"><span className={`rounded-md px-2 py-0.5 text-xs font-medium ${ROLE_STYLE[m.role]}`}>{m.role}</span></td>
                  <td className="px-4 py-3 text-ink-soft">{new Date(m.created_at).toLocaleDateString('es-MX')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <h2 className="mt-8 mb-3 font-display text-sm font-semibold uppercase tracking-wide text-ink-mute">Zona de peligro</h2>
      <div className="rounded-xl border border-red-200 bg-red-50/40 p-5 text-sm text-ink-soft">
        Invitar/remover operadores, delegar accesos y acciones destructivas llegan en
        <span className="font-medium text-ink"> Fase 8</span>.
      </div>
    </div>
  )
}
