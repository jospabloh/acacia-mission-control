import { Outlet, useLocation } from 'react-router-dom'
import { Nav } from './Nav.jsx'
import { PILLARS } from '../lib/nav.js'
import { useAuth } from '../lib/auth/useAuth.js'

function initials(email = '') {
  return email.slice(0, 2).toUpperCase()
}

function currentTitle(pathname) {
  if (pathname.startsWith('/apps/')) return 'Detalle de app'
  return PILLARS.find((p) => p.to === pathname)?.label ?? 'Mission Control'
}

export function Layout() {
  const { user, role, signOut } = useAuth()
  const { pathname } = useLocation()

  return (
    <div className="min-h-screen bg-paper text-ink">
      <div className="flex">
        {/* Sidebar */}
        <aside className="w-64 shrink-0 sticky top-0 h-screen bg-paper-card border-r border-hair flex flex-col">
          <div className="px-4 pt-5 pb-4 border-b border-hair">
            <img src="/brand/acacia-logo.jpg" alt="ACACIA" className="h-8 w-auto" />
            <div className="mt-2 flex items-center gap-1.5">
              <img src="/mc-mark.svg" alt="" className="h-4 w-4" />
              <span className="text-[11px] font-semibold tracking-wide text-ink-mute">MISSION CONTROL</span>
            </div>
          </div>

          <Nav />

          <div className="mt-auto p-3 border-t border-hair">
            <div className="flex items-center gap-2.5 px-1">
              <div className="h-8 w-8 rounded-full bg-brand/10 text-brand grid place-items-center text-xs font-semibold">
                {initials(user?.email)}
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-xs font-medium text-ink truncate">{user?.email}</div>
                <div className="text-[10px] uppercase tracking-wide text-ink-faint">{role}</div>
              </div>
              <button onClick={signOut} title="Cerrar sesión"
                className="text-ink-faint hover:text-ink p-1 rounded">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9" />
                </svg>
              </button>
            </div>
          </div>
        </aside>

        {/* Main */}
        <div className="flex-1 min-w-0">
          <header className="sticky top-0 z-10 h-14 px-8 flex items-center justify-between bg-paper/80 backdrop-blur border-b border-hair">
            <div className="font-display text-sm font-semibold text-ink">{currentTitle(pathname)}</div>
            <div className="flex items-center gap-2 text-xs text-ink-mute">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
              producción
            </div>
          </header>
          <main className="p-8 max-w-6xl">
            <Outlet />
          </main>
        </div>
      </div>
    </div>
  )
}
