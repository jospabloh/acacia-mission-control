import { createContext } from 'react'

// Shape: { session, user, member, role, loading, signInWithEmail, signOut }
// `member` is the row from public.members; `role` ∈ owner|admin|viewer|null.
export const AuthContext = createContext(null)
