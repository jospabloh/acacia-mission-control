import { useEffect, useState } from 'react'
import { useAuth } from '../lib/auth/useAuth.js'
import { getRememberedIdentity, clearRememberedIdentity } from '../lib/lastIdentity.js'

// Google sign-in is only shown once the provider is actually configured in
// Supabase (Auth → Providers → Google) + a Google Cloud OAuth client exists.
// Flip VITE_GOOGLE_OAUTH=on (then redeploy) to reveal the button. Off by
// default so production never shows a button that can't complete.
const GOOGLE_ENABLED = import.meta.env.VITE_GOOGLE_OAUTH === 'on'

// The portfolio this console operates — its real marks double as the page's
// signature: ACACIA Mission Control is the control room for these systems.
const SYSTEMS = [
  { id: 'puntos', name: 'Puntos+', logo: '/brand/puntos.png' },
  { id: 'rumbo', name: 'Rumbo', logo: '/brand/rumbo.png' },
  { id: 'liuma', name: 'LIUMA', logo: '/brand/liuma.png' },
  { id: 'flowfin', name: 'FlowFin', logo: '/brand/flowfin.svg' },
  { id: 'stockflow', name: 'StockFlow', logo: '/brand/stockflow.svg' },
  { id: 'plink', name: 'Plink FX', logo: null },
]

// Always resolve any thrown/returned value to a legible Spanish string.
function errText(err) {
  if (!err) return null
  if (typeof err === 'string') return err
  const m = err.message || err.error_description || err.error || ''
  if (/provider is not enabled|Unsupported provider/i.test(m)) {
    return 'Google aún no está habilitado. Actívalo en Supabase → Authentication → Providers → Google.'
  }
  if (/Invalid login credentials/i.test(m)) return 'Correo o contraseña incorrectos.'
  if (/Failed to fetch|NetworkError/i.test(m)) return 'No hay conexión con el servidor. Revisa tu red e intenta de nuevo.'
  return m || 'No se pudo iniciar sesión. Intenta de nuevo.'
}

function GoogleMark() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
      <path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62Z" />
      <path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.8.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.33A9 9 0 0 0 9 18Z" />
      <path fill="#FBBC05" d="M3.97 10.72a5.4 5.4 0 0 1 0-3.44V4.95H.96a9 9 0 0 0 0 8.1l3.01-2.33Z" />
      <path fill="#EA4335" d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58A9 9 0 0 0 .96 4.95l3.01 2.33C4.68 5.16 6.66 3.58 9 3.58Z" />
    </svg>
  )
}

export function LoginGate({ children }) {
  const { loading, user, role, signInWithEmail, signInWithGoogle, signOut } = useAuth()
  // Welcome-back: remember the last operator (cosmetic) to greet them by name.
  const [remembered, setRemembered] = useState(() => getRememberedIdentity())
  const [useOther, setUseOther] = useState(false)
  const [email, setEmail] = useState(remembered?.email || '')
  const [password, setPassword] = useState('')
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)
  const [googleBusy, setGoogleBusy] = useState(false)
  const personalized = remembered && !useOther
  const firstName = remembered?.name ? remembered.name.split(' ')[0] : null
  const switchAccount = () => {
    clearRememberedIdentity(); setRemembered(null); setUseOther(true)
    setEmail(''); setPassword(''); setError(null)
  }

  // Surface an OAuth error handed back in the URL (Supabase returns it in the hash).
  useEffect(() => {
    const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''))
    const desc = hash.get('error_description') || hash.get('error')
    if (desc) {
      setError(errText(desc))
      window.history.replaceState(null, '', window.location.pathname)
    }
  }, [])

  if (loading) {
    return (
      <div className="console-bg min-h-screen grid place-items-center">
        <div className="flex items-center gap-3 text-ink-mute">
          <span className="h-2 w-2 rounded-full bg-brand animate-pulse" />
          <span className="font-display text-sm tracking-wide">Iniciando consola…</span>
        </div>
      </div>
    )
  }

  // Signed in but not provisioned as an operator → no access.
  if (user && !role) {
    return (
      <div className="console-bg min-h-screen grid place-items-center px-4">
        <div className="rise w-full max-w-md rounded-2xl bg-paper-card border border-hair shadow-card p-8 text-center">
          <div className="flex items-center justify-center gap-3">
            <img src="/brand/acacia-logo.jpg" alt="ACACIA" className="h-12 w-auto" />
            <span className="h-9 w-px bg-hair" />
            <img src="/mc-mark.svg" alt="Mission Control" className="h-9 w-9" />
          </div>
          <h1 className="mt-5 font-display text-lg font-semibold text-ink">Cuenta sin acceso</h1>
          <p className="mt-2 text-sm text-ink-soft">
            <span className="font-medium text-ink">{user.email}</span> no está autorizada como operador
            de Mission Control. Pide a un owner que te agregue.
          </p>
          <button onClick={signOut}
            className="mt-6 text-sm font-medium text-brand hover:text-brand-deep">
            Cerrar sesión
          </button>
        </div>
      </div>
    )
  }

  if (user && role) return children

  const onSubmit = async (e) => {
    e.preventDefault()
    setBusy(true); setError(null)
    try {
      const { error } = await signInWithEmail(email, password)
      if (error) setError(errText(error))
    } catch (err) {
      setError(errText(err))
    } finally {
      setBusy(false)
    }
  }

  const onGoogle = async () => {
    setGoogleBusy(true); setError(null)
    try {
      const { error } = await signInWithGoogle()
      if (error) { setError(errText(error)); setGoogleBusy(false) }
      // on success the browser redirects to Google — keep the spinner.
    } catch (err) {
      setError(errText(err)); setGoogleBusy(false)
    }
  }

  return (
    <div className="console-bg min-h-screen grid place-items-center px-4 py-10">
      <div className="rise w-full max-w-md">
        <div className="rounded-2xl bg-paper-card border border-hair shadow-card overflow-hidden">
          {/* status rail */}
          <div className="flex items-center justify-between px-6 h-10 border-b border-hair bg-paper-subtle/60">
            <span className="font-display text-[11px] font-semibold tracking-[0.18em] text-ink-mute">
              MISSION&nbsp;CONTROL
            </span>
            <span className="flex items-center gap-1.5 text-[11px] text-ink-mute">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
              en línea
            </span>
          </div>

          <div className="px-7 pt-8 pb-7">
            {/* co-brand: ACACIA (house brand) · Mission Control (product, own mark) */}
            <div className="flex items-center gap-3">
              <img src="/brand/acacia-logo.jpg" alt="ACACIA Consultoría" className="h-12 w-auto" />
              <span className="h-9 w-px bg-hair" />
              <span className="flex items-center gap-2">
                <img src="/mc-mark.svg" alt="" className="h-7 w-7" />
                <span className="font-display text-sm font-semibold tracking-wide text-ink leading-tight">
                  Mission<br />Control
                </span>
              </span>
            </div>
            {personalized ? (
              /* ── Welcome back — premium, personalized ───────────────────── */
              <>
                <div className="mt-7 flex flex-col items-center text-center">
                  {remembered.avatar ? (
                    <img src={remembered.avatar} alt="" className="h-20 w-20 rounded-full object-cover ring-4 ring-brand/10" />
                  ) : (
                    <div className="grid h-20 w-20 place-items-center rounded-full bg-gradient-to-br from-brand to-brand-deep text-3xl font-semibold text-white shadow-glow">
                      {(remembered.name || remembered.email).trim().charAt(0).toUpperCase()}
                    </div>
                  )}
                  <h1 className="mt-5 font-display text-2xl font-semibold tracking-tight text-ink">
                    ¡Bienvenido de nuevo{firstName ? `, ${firstName}` : ''}!
                  </h1>
                  {remembered.email && <p className="mt-1 text-sm text-ink-soft">{remembered.email}</p>}
                </div>

                {GOOGLE_ENABLED && (
                  <button onClick={onGoogle} disabled={googleBusy || busy}
                    className="mt-6 w-full h-11 inline-flex items-center justify-center gap-3 rounded-xl border border-hair bg-white text-sm font-medium text-ink hover:bg-paper-subtle transition-colors disabled:opacity-60">
                    {googleBusy
                      ? <span className="font-display tracking-wide text-ink-mute">Redirigiendo…</span>
                      : <><GoogleMark /> Continuar con Google</>}
                  </button>
                )}

                <form onSubmit={onSubmit} className={`space-y-3 ${GOOGLE_ENABLED ? 'mt-4' : 'mt-7'}`}>
                  {/* email is known — keep it for the form + password managers, hidden */}
                  <input type="email" value={email} readOnly hidden autoComplete="username" />
                  <label className="block">
                    <span className="text-xs font-medium text-ink-soft">Contraseña</span>
                    <input type="password" value={password} required autoFocus autoComplete="current-password"
                      onChange={(e) => setPassword(e.target.value)} placeholder="••••••••••"
                      className="mt-1 w-full h-11 rounded-xl border border-hair bg-white px-3.5 text-sm text-ink outline-none focus:border-brand focus:ring-4 focus:ring-brand/10 transition" />
                  </label>

                  {error && (
                    <p role="alert" className="flex items-start gap-2 rounded-lg bg-red-50 border border-red-100 px-3 py-2 text-sm text-red-700">
                      <span aria-hidden="true" className="mt-px">⚠</span>
                      <span>{error}</span>
                    </p>
                  )}

                  <button type="submit" disabled={busy || googleBusy}
                    className="w-full h-11 rounded-xl bg-brand text-white text-sm font-semibold shadow-glow hover:bg-brand-deep transition-colors disabled:opacity-60">
                    {busy ? 'Entrando…' : `Continuar como ${firstName || 'mí'}`}
                  </button>
                  <button type="button" onClick={switchAccount}
                    className="w-full pt-1 text-center text-sm font-medium text-ink-mute hover:text-ink transition">
                    Usar otra cuenta
                  </button>
                </form>
              </>
            ) : (
              /* ── Generic operator login ─────────────────────────────────── */
              <>
                <h1 className="mt-7 font-display text-2xl font-semibold text-ink tracking-tight">
                  Acceso de operador
                </h1>
                <p className="mt-1 text-sm text-ink-soft">
                  Centro de control del portafolio ACACIA.
                </p>

                {/* Google — primary path (shown only when the provider is configured) */}
                {GOOGLE_ENABLED && (
                  <>
                    <button onClick={onGoogle} disabled={googleBusy || busy}
                      className="mt-6 w-full h-11 inline-flex items-center justify-center gap-3 rounded-xl border border-hair bg-white text-sm font-medium text-ink hover:bg-paper-subtle transition-colors disabled:opacity-60">
                      {googleBusy
                        ? <span className="font-display tracking-wide text-ink-mute">Redirigiendo…</span>
                        : <><GoogleMark /> Continuar con Google</>}
                    </button>

                    <div className="my-5 flex items-center gap-3 text-[11px] uppercase tracking-wider text-ink-faint">
                      <span className="h-px flex-1 bg-hair" /> o con tu correo <span className="h-px flex-1 bg-hair" />
                    </div>
                  </>
                )}

                <form onSubmit={onSubmit} className={`space-y-3 ${GOOGLE_ENABLED ? '' : 'mt-6'}`}>
                  <label className="block">
                    <span className="text-xs font-medium text-ink-soft">Correo</span>
                    <input type="email" value={email} required autoComplete="email"
                      onChange={(e) => setEmail(e.target.value)} placeholder="tu@acaciaco.com.mx"
                      className="mt-1 w-full h-11 rounded-xl border border-hair bg-white px-3.5 text-sm text-ink outline-none focus:border-brand focus:ring-4 focus:ring-brand/10 transition" />
                  </label>
                  <label className="block">
                    <span className="text-xs font-medium text-ink-soft">Contraseña</span>
                    <input type="password" value={password} required autoComplete="current-password"
                      onChange={(e) => setPassword(e.target.value)} placeholder="••••••••••"
                      className="mt-1 w-full h-11 rounded-xl border border-hair bg-white px-3.5 text-sm text-ink outline-none focus:border-brand focus:ring-4 focus:ring-brand/10 transition" />
                  </label>

                  {error && (
                    <p role="alert" className="flex items-start gap-2 rounded-lg bg-red-50 border border-red-100 px-3 py-2 text-sm text-red-700">
                      <span aria-hidden="true" className="mt-px">⚠</span>
                      <span>{error}</span>
                    </p>
                  )}

                  <button type="submit" disabled={busy || googleBusy}
                    className="w-full h-11 rounded-xl bg-brand text-white text-sm font-semibold shadow-glow hover:bg-brand-deep transition-colors disabled:opacity-60">
                    {busy ? 'Entrando…' : 'Entrar'}
                  </button>
                </form>
              </>
            )}
          </div>
        </div>

        {/* signature: the systems this console operates */}
        <div className="mt-6 px-1">
          <div className="flex items-center gap-2 text-[11px] uppercase tracking-wider text-ink-mute">
            <span className="h-1.5 w-1.5 rounded-full bg-brand" />
            Operando el portafolio
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-3">
            {SYSTEMS.map((s) => (
              <span key={s.id} title={s.name} className="inline-flex items-center">
                {s.logo
                  ? <img src={s.logo} alt={s.name} className="h-5 w-auto max-w-[88px] object-contain opacity-50 grayscale hover:opacity-100 hover:grayscale-0 transition" />
                  : <span className="font-display text-xs font-semibold text-ink-mute hover:text-ink transition">{s.name}</span>}
              </span>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
