import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../supabase.js'
import { AuthContext } from './AuthContext.js'
import { rememberIdentity, clearRememberedIdentity } from '../lastIdentity.js'

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null)
  const [member, setMember] = useState(null)
  const [loading, setLoading] = useState(true)

  // Load the members row for the current user (NULL → not an operator). Takes the
  // full auth user so we can remember a provisioned operator's display identity
  // (cosmetic only) for the "Bienvenido de nuevo" screen next time.
  const loadMember = useCallback(async (user) => {
    if (!user?.id) { setMember(null); return }
    const { data, error } = await supabase
      .from('members')
      .select('*')
      .eq('user_id', user.id)
      .maybeSingle()
    if (error) console.error('[auth] member lookup failed', error.message)
    setMember(data ?? null)
    if (data) rememberIdentity(user) // only remember actual operators
  }, [])

  useEffect(() => {
    let active = true
    supabase.auth.getSession().then(async ({ data }) => {
      if (!active) return
      setSession(data.session)
      await loadMember(data.session?.user)
      setLoading(false)
    })

    const { data: sub } = supabase.auth.onAuthStateChange(async (_event, newSession) => {
      setSession(newSession)
      await loadMember(newSession?.user)
    })
    return () => { active = false; sub.subscription.unsubscribe() }
  }, [loadMember])

  const signInWithEmail = useCallback(async (email, password) => {
    return supabase.auth.signInWithPassword({ email, password })
  }, [])

  const signInWithGoogle = useCallback(async () => {
    return supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: window.location.origin,
        queryParams: { prompt: 'select_account' },
      },
    })
  }, [])

  const signOut = useCallback(async () => {
    clearRememberedIdentity() // forget the welcome-back identity on explicit sign-out
    await supabase.auth.signOut()
  }, [])

  const value = useMemo(() => ({
    session,
    user: session?.user ?? null,
    member,
    role: member?.role ?? null,
    loading,
    signInWithEmail,
    signInWithGoogle,
    signOut,
  }), [session, member, loading, signInWithEmail, signInWithGoogle, signOut])

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
