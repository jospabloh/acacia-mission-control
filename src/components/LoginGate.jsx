import { useState } from 'react'
import { useAuth } from '../lib/auth/useAuth.js'

// Gate the whole app: must be signed in AND be a member (have a role).
export function LoginGate({ children }) {
  const { loading, user, role, signInWithEmail, signOut } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)

  if (loading) {
    return <div className="min-h-screen grid place-items-center text-acacia-500">Cargando…</div>
  }

  if (!user) {
    const onSubmit = async (e) => {
      e.preventDefault()
      setBusy(true); setError(null)
      const { error } = await signInWithEmail(email, password)
      if (error) setError(error.message)
      setBusy(false)
    }
    return (
      <div className="min-h-screen grid place-items-center bg-acacia-50 px-4">
        <form onSubmit={onSubmit} className="w-full max-w-sm bg-white rounded-xl shadow p-6 space-y-4">
          <div>
            <h1 className="text-xl font-semibold text-acacia-900">ACACIA Mission Control</h1>
            <p className="text-sm text-acacia-500">Acceso de operador</p>
          </div>
          <input
            type="email" placeholder="Correo" value={email} required autoFocus
            onChange={(e) => setEmail(e.target.value)}
            className="w-full border rounded-lg px-3 py-2 text-sm" />
          <input
            type="password" placeholder="Contraseña" value={password} required
            onChange={(e) => setPassword(e.target.value)}
            className="w-full border rounded-lg px-3 py-2 text-sm" />
          {error && <p className="text-sm text-red-600">{error}</p>}
          <button type="submit" disabled={busy}
            className="w-full bg-acacia-900 text-white rounded-lg py-2 text-sm disabled:opacity-50">
            {busy ? 'Entrando…' : 'Entrar'}
          </button>
        </form>
      </div>
    )
  }

  // Signed in but not provisioned as a member → no access.
  if (!role) {
    return (
      <div className="min-h-screen grid place-items-center bg-acacia-50 px-4 text-center">
        <div className="max-w-sm space-y-3">
          <h1 className="text-lg font-semibold text-acacia-900">Sin acceso</h1>
          <p className="text-sm text-acacia-500">
            Tu cuenta ({user.email}) no está autorizada como operador de Mission Control.
            Pide a un owner que te agregue en <code>members</code>.
          </p>
          <button onClick={signOut} className="text-sm text-acacia-700 underline">Cerrar sesión</button>
        </div>
      </div>
    )
  }

  return children
}
