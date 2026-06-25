import { useEffect, useState } from 'react'
import { NavLink } from 'react-router-dom'
import { PILLARS } from '../lib/nav.js'
import { useAuth, roleAtLeast } from '../lib/auth/useAuth.js'
import { fetchApps } from '../lib/appRegistry.js'

export function Nav() {
  const { role } = useAuth()
  const [apps, setApps] = useState([])

  useEffect(() => {
    fetchApps().then(setApps).catch((e) => console.error('[nav] apps', e.message))
  }, [])

  const linkClass = ({ isActive }) =>
    `block rounded-lg px-3 py-2 text-sm ${isActive ? 'bg-acacia-900 text-white' : 'text-acacia-700 hover:bg-acacia-100'}`

  return (
    <nav className="space-y-1">
      <div className="px-3 pb-1 text-xs font-semibold uppercase tracking-wide text-acacia-500">Pilares</div>
      {PILLARS.filter((p) => roleAtLeast(role, p.minRole)).map((p) => (
        <NavLink key={p.to} to={p.to} end={p.to === '/'} className={linkClass}>{p.label}</NavLink>
      ))}

      <div className="px-3 pt-4 pb-1 text-xs font-semibold uppercase tracking-wide text-acacia-500">Apps</div>
      {apps.map((a) => (
        <NavLink key={a.id} to={`/apps/${a.id}`} className={linkClass}>
          <span className="inline-flex items-center gap-2">
            <span className={`h-2 w-2 rounded-full ${a.status === 'active' ? 'bg-green-500' : 'bg-amber-400'}`} />
            {a.name}
          </span>
        </NavLink>
      ))}
      {apps.length === 0 && <div className="px-3 text-xs text-acacia-500">Sin apps en el registro</div>}
    </nav>
  )
}
