import { useEffect, useState } from 'react'
import { NavLink } from 'react-router-dom'
import { PILLARS } from '../lib/nav.js'
import { useAuth, roleAtLeast } from '../lib/auth/useAuth.js'
import { fetchApps } from '../lib/appRegistry.js'
import { Icon } from './icons.jsx'

function SectionLabel({ children }) {
  return <div className="px-3 pt-5 pb-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-ink-faint">{children}</div>
}

// Sidebar app groups mirror the dashboard categories.
const APP_SECTIONS = [
  { key: 'app', label: 'Apps · SaaS' },
  { key: 'freeware', label: 'Freeware' },
  { key: 'site', label: 'Sitios web' },
]

export function Nav() {
  const { role } = useAuth()
  const [apps, setApps] = useState([])

  useEffect(() => {
    fetchApps().then(setApps).catch((e) => console.error('[nav] apps', e.message))
  }, [])

  const linkClass = ({ isActive }) =>
    `group flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors ${
      isActive ? 'bg-brand text-white shadow-glow' : 'text-ink-soft hover:bg-paper-subtle hover:text-ink'
    }`

  return (
    <nav className="flex-1 overflow-y-auto px-2">
      <SectionLabel>Pilares</SectionLabel>
      {PILLARS.filter((p) => roleAtLeast(role, p.minRole)).map((p) => (
        <NavLink key={p.to} to={p.to} end={p.to === '/'} className={linkClass}>
          {({ isActive }) => (
            <>
              <Icon name={p.icon} size={18} className={isActive ? 'text-white' : 'text-ink-mute group-hover:text-brand'} />
              <span className="flex-1">{p.label}</span>
            </>
          )}
        </NavLink>
      ))}

      {APP_SECTIONS.map(({ key, label }) => {
        const items = apps.filter((a) => (a.category || 'app') === key)
        if (items.length === 0) return null
        return (
          <div key={key}>
            <SectionLabel>{label}</SectionLabel>
            {items.map((a) => (
              <NavLink key={a.id} to={`/apps/${a.id}`} className={linkClass}>
                <span className={`h-2 w-2 rounded-full ml-1 ${a.status === 'active' ? 'bg-emerald-500' : 'bg-amber-400'}`} />
                <span className="flex-1 truncate">{a.name}</span>
              </NavLink>
            ))}
          </div>
        )
      })}
      {apps.length === 0 && <div className="px-3 text-xs text-ink-faint">Sin apps en el registro</div>}
    </nav>
  )
}
