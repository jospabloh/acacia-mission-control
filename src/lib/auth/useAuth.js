import { useContext } from 'react'
import { AuthContext } from './AuthContext.js'

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within <AuthProvider>')
  return ctx
}

// Role rank helper, mirrors the SQL is_member_at_least().
const RANK = { owner: 3, admin: 2, viewer: 1 }
export function roleAtLeast(role, min) {
  return (RANK[role] ?? 0) >= (RANK[min] ?? 99)
}
