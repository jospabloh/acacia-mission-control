import { Outlet } from 'react-router-dom'
import { Nav } from './Nav.jsx'
import { useAuth } from '../lib/auth/useAuth.js'

export function Layout() {
  const { user, role, signOut } = useAuth()
  return (
    <div className="min-h-screen bg-acacia-50 text-acacia-900">
      <div className="flex">
        <aside className="w-60 shrink-0 border-r bg-white min-h-screen p-4 flex flex-col">
          <div className="px-3 pb-4">
            <div className="font-semibold">ACACIA</div>
            <div className="text-xs text-acacia-500">Mission Control</div>
          </div>
          <Nav />
          <div className="mt-auto pt-4 border-t text-xs text-acacia-500">
            <div className="px-3 truncate">{user?.email}</div>
            <div className="px-3 mb-2 capitalize">rol: {role}</div>
            <button onClick={signOut} className="px-3 text-acacia-700 underline">Cerrar sesión</button>
          </div>
        </aside>
        <main className="flex-1 p-8 max-w-6xl">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
