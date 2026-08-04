import { useEffect, useState } from 'react'
import { Outlet, useLocation } from 'react-router-dom'
import { Nav } from './Nav.jsx'
import { PILLARS } from '../lib/nav.js'
import { useAuth } from '../lib/auth/useAuth.js'

function initials(email = '') {
  return email.slice(0, 2).toUpperCase()
}

// Dedicated drill-down views reached from a Dashboard stat card, not the sidebar.
const EXTRA_TITLES = { '/tenants': 'Tenants', '/sessions': 'Sesiones activas', '/products': 'Productos' }

function currentTitle(pathname) {
  if (pathname.startsWith('/apps/')) return 'Detalle de app'
  return PILLARS.find((p) => p.to === pathname)?.label ?? EXTRA_TITLES[pathname] ?? 'Mission Control'
}

export function Layout() {
  const { user, role, signOut } = useAuth()
  const { pathname } = useLocation()
  // Sidebar is an off-canvas drawer below the `lg` breakpoint, static above it.
  const [menuOpen, setMenuOpen] = useState(false)

  // A route change means the operator tapped a nav link — close the drawer.
  useEffect(() => { setMenuOpen(false) }, [pathname])

  return (
    <div className="min-h-screen bg-paper text-ink">
      <div className="lg:flex">
        {/* Backdrop (mobile only, shown while the drawer is open) */}
        {menuOpen && (
          <div
            className="fixed inset-0 z-30 bg-ink/40 lg:hidden"
            onClick={() => setMenuOpen(false)}
            aria-hidden="true"
          />
        )}

        {/* Sidebar: off-canvas drawer on mobile, static column from `lg` up */}
        <aside
          className={`fixed inset-y-0 left-0 z-40 w-64 shrink-0 bg-paper-card border-r border-hair flex flex-col
            transition-transform duration-200 ease-out
            ${menuOpen ? 'translate-x-0' : '-translate-x-full'}
            lg:sticky lg:top-0 lg:h-screen lg:translate-x-0`}
        >
          <div className="px-4 pt-5 pb-4 border-b border-hair flex items-center justify-between">
            <div>
              <img src="/brand/acacia-logo.jpg" alt="ACACIA" className="h-8 w-auto" />
              <div className="mt-2 flex items-center gap-1.5">
                <img src="/mc-mark.svg" alt="" className="h-4 w-4" />
                <span className="text-[11px] font-semibold tracking-wide text-ink-mute">MISSION CONTROL</span>
              </div>
            </div>
            <button onClick={() => setMenuOpen(false)} title="Cerrar menú"
              className="lg:hidden text-ink-faint hover:text-ink p-1 rounded">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M18 6 6 18M6 6l12 12" />
              </svg>
            </button>
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
        <div className="min-w-0 lg:flex-1">
          <header className="sticky top-0 z-20 h-14 px-4 lg:px-8 flex items-center justify-between bg-paper/80 backdrop-blur border-b border-hair">
            <div className="flex items-center gap-3 min-w-0">
              <button onClick={() => setMenuOpen(true)} title="Abrir menú"
                className="lg:hidden -ml-1 p-1.5 rounded text-ink-mute hover:text-ink hover:bg-paper-subtle">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M4 6h16M4 12h16M4 18h16" />
                </svg>
              </button>
              <div className="font-display text-sm font-semibold text-ink truncate">{currentTitle(pathname)}</div>
            </div>
            <div className="hidden sm:flex items-center gap-2 text-xs text-ink-mute shrink-0">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
              producción
            </div>
          </header>
          <main className="p-4 sm:p-6 lg:p-8 max-w-6xl">
            <Outlet />
          </main>
        </div>
      </div>
    </div>
  )
}
