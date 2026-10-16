import { Outlet } from 'react-router-dom'
import AppShell from './AppShell.jsx'
import { Icon } from './icons.jsx'
import { PILLARS } from '../lib/nav.js'
import { useAuth, roleAtLeast } from '../lib/auth/useAuth.js'

// The shared shell (module 29) renders `item.icon` as a component; this
// console's icons are looked up by name. One wrapper per pillar, built once at
// module scope so the <nav> never sees a new component type (module 23).
const NAV = PILLARS.map((p) => ({
  to: p.to,
  label: p.label,
  end: p.to === '/',
  minRole: p.minRole,
  icon: function PillarIcon({ className }) {
    return <Icon name={p.icon} size={20} className={className} />
  },
}))

// The registry's apps are deliberately not in the sidebar: the shell takes one
// flat list, and the Dashboard already lists and links every app.
// No `feedback`: Mission Control is where module 8's tickets land, not a sender.
export function Layout() {
  const { user, role, signOut } = useAuth()

  return (
    <AppShell
      app={{ name: 'Mission Control', logo: '/mc-mark.svg' }}
      sectionLabel="Pilares"
      nav={NAV.filter((item) => roleAtLeast(role, item.minRole))}
      context={
        <span className="flex items-center gap-2 text-xs text-muted-foreground">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
          producción
        </span>
      }
      user={{ name: user?.user_metadata?.full_name, email: user?.email, role }}
      onSignOut={signOut}
    >
      <div className="max-w-6xl pb-20">
        <Outlet />
      </div>
    </AppShell>
  )
}
