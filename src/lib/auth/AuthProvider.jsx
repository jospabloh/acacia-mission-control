import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../supabase.js'
import { AuthContext } from './AuthContext.js'

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null)
  const [member, setMember] = useState(null)
  const [loading, setLoading] = useState(true)

  // Load the members row for the current user (NULL → not an operator).
  const loadMember = useCallback(async (userId) => {
    if (!userId) { setMember(null); return }
    const { data, error } = await supabase
      .from('members')
      .select('*')
      .eq('user_id', userId)
      .maybeSingle()
    if (error) console.error('[auth] member lookup failed', error.message)
    setMember(data ?? null)
  }, [])

  useEffect(() => {
    let active = true
    supabase.auth.getSession().then(async ({ data }) => {
      if (!active) return
      setSession(data.session)
      await loadMember(data.session?.user?.id)
      setLoading(false)
    })

    const { data: sub } = supabase.auth.onAuthStateChange(async (_event, newSession) => {
      setSession(newSession)
      await loadMember(newSession?.user?.id)
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
