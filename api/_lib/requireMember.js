// Authenticate a browser caller for the control endpoints. The client sends its
// Supabase session JWT as `Authorization: Bearer <access_token>`; we validate it
// with the service-role client and resolve the operator's Mission Control role
// from `members`. Returns the member on success, or writes an error and returns
// null. `api/cron/*` stays machine-gated (CRON_SECRET) — this is for human,
// in-app control actions only.
import { supabaseAdmin } from './supabaseAdmin.js'

const RANK = { viewer: 1, admin: 2, owner: 3 }

export async function requireMember(req, res, minRole = 'admin') {
  const auth = req.headers.authorization || ''
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null
  if (!token) { res.status(401).json({ error: 'falta el token de sesión' }); return null }

  const { data: userData, error: uErr } = await supabaseAdmin.auth.getUser(token)
  if (uErr || !userData?.user) { res.status(401).json({ error: 'sesión inválida' }); return null }

  const { data: member } = await supabaseAdmin
    .from('members').select('user_id, email, role').eq('user_id', userData.user.id).maybeSingle()
  if (!member) { res.status(403).json({ error: 'no eres miembro de Mission Control' }); return null }

  if ((RANK[member.role] ?? 0) < (RANK[minRole] ?? 99)) {
    res.status(403).json({ error: `requiere rol ${minRole} o superior` }); return null
  }
  return member
}
