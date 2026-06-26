// Cosmetic-only memory of the last operator who signed in, to render the
// "Bienvenido de nuevo" welcome-back screen on the login gate.
//
// SECURITY: never stores tokens or anything used for authorization. The real
// session is the Supabase session + the members RLS role. A remembered identity
// does NOT grant access — it only personalizes the login screen. Cleared on
// "usar otra cuenta" and on sign-out.
const KEY = 'acacia_mc_last_identity_v1'

// Accepts a Supabase auth user (identity in user_metadata) and keeps only
// non-sensitive display fields.
export function rememberIdentity(user) {
  if (typeof window === 'undefined' || !user) return
  try {
    const md = user.user_metadata || {}
    const identity = {
      name: md.full_name || md.name || null,
      email: user.email || null,
      avatar: md.avatar_url || md.picture || null,
    }
    if (!identity.name && !identity.email) return
    window.localStorage.setItem(KEY, JSON.stringify(identity))
  } catch { /* storage unavailable — non-fatal */ }
}

export function getRememberedIdentity() {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.localStorage.getItem(KEY)
    if (!raw) return null
    const id = JSON.parse(raw)
    return id && (id.name || id.email) ? id : null
  } catch { return null }
}

export function clearRememberedIdentity() {
  if (typeof window === 'undefined') return
  try { window.localStorage.removeItem(KEY) } catch { /* ignore */ }
}
