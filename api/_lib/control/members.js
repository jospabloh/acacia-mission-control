// Member management (F8 Ajustes) — the ONLY pillar that writes to `members`,
// so it is strictly owner-gated. Invites must run server-side: granting access
// creates/links a Supabase Auth user (service-role admin API), which the browser
// anon client cannot do. List + role change + removal also go through here so
// every mutation is audited in one place. Ops: list | invite | set-role | remove.
import { supabaseAdmin, requireSupabase, audit } from '../supabaseAdmin.js'
import { requireMember } from '../requireMember.js'

const ROLES = ['owner', 'admin', 'viewer']

// Count current owners — used to refuse demoting/removing the last one (lockout).
async function ownerCount() {
  const { count } = await supabaseAdmin
    .from('members').select('user_id', { count: 'exact', head: true }).eq('role', 'owner')
  return count ?? 0
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method not allowed' })
  if (!requireSupabase(res)) return
  const me = await requireMember(req, res, 'owner')
  if (!me) return

  const { op } = req.body ?? {}

  // ── list ────────────────────────────────────────────────────────────────────
  if (op === 'list') {
    const { data, error } = await supabaseAdmin
      .from('members').select('user_id, email, role, created_at').order('created_at', { ascending: true })
    if (error) return res.status(500).json({ error: error.message })
    return res.status(200).json({ ok: true, members: data ?? [] })
  }

  // ── invite (or grant access to an existing auth user) ────────────────────────
  if (op === 'invite') {
    const email = String(req.body?.email || '').trim().toLowerCase()
    const role = req.body?.role
    if (!email || !email.includes('@')) return res.status(400).json({ error: 'email inválido' })
    if (!ROLES.includes(role)) return res.status(400).json({ error: 'rol inválido' })

    // Resolve the auth user: invite creates it (and emails the invite); if the
    // address is already registered, look it up and just grant membership.
    let userId = null
    let invited = false
    const redirectTo = process.env.PUBLIC_APP_URL || process.env.VITE_PUBLIC_APP_URL || undefined
    const { data: inv, error: invErr } = await supabaseAdmin.auth.admin.inviteUserByEmail(email, { redirectTo })
    if (invErr) {
      // Most common cause: user already exists. Page through auth users to find it.
      let found = null
      for (let page = 1; page <= 10 && !found; page++) {
        const { data: list, error: lErr } = await supabaseAdmin.auth.admin.listUsers({ page, perPage: 200 })
        if (lErr) return res.status(502).json({ error: lErr.message })
        found = (list?.users || []).find((u) => (u.email || '').toLowerCase() === email) || null
        if (!list?.users?.length || list.users.length < 200) break
      }
      if (!found) return res.status(502).json({ error: invErr.message })
      userId = found.id
    } else {
      userId = inv?.user?.id
      invited = true
    }
    if (!userId) return res.status(502).json({ error: 'no se pudo resolver el usuario' })

    const { error: upErr } = await supabaseAdmin
      .from('members').upsert({ user_id: userId, email, role }, { onConflict: 'user_id' })
    if (upErr) return res.status(500).json({ error: upErr.message })

    await audit('control:member-invite', {
      actor: me.user_id, actor_email: me.email, target_type: 'member', target_id: userId,
      payload: { email, role, invited },
    })
    return res.status(200).json({ ok: true, op, user_id: userId, email, role, invited })
  }

  // ── set-role ─────────────────────────────────────────────────────────────────
  if (op === 'set-role') {
    const userId = req.body?.userId
    const role = req.body?.role
    if (!userId || !ROLES.includes(role)) return res.status(400).json({ error: 'falta userId/role válido' })

    const { data: target } = await supabaseAdmin.from('members').select('role, email').eq('user_id', userId).maybeSingle()
    if (!target) return res.status(404).json({ error: 'miembro no encontrado' })
    if (target.role === 'owner' && role !== 'owner' && (await ownerCount()) <= 1) {
      return res.status(400).json({ error: 'no puedes degradar al único owner' })
    }

    const { error } = await supabaseAdmin.from('members').update({ role }).eq('user_id', userId)
    if (error) return res.status(500).json({ error: error.message })
    await audit('control:member-role', {
      actor: me.user_id, actor_email: me.email, target_type: 'member', target_id: userId,
      payload: { email: target.email, from: target.role, to: role },
    })
    return res.status(200).json({ ok: true, op, user_id: userId, role })
  }

  // ── remove ───────────────────────────────────────────────────────────────────
  if (op === 'remove') {
    const userId = req.body?.userId
    if (!userId) return res.status(400).json({ error: 'falta userId' })

    const { data: target } = await supabaseAdmin.from('members').select('role, email').eq('user_id', userId).maybeSingle()
    if (!target) return res.status(404).json({ error: 'miembro no encontrado' })
    if (target.role === 'owner' && (await ownerCount()) <= 1) {
      return res.status(400).json({ error: 'no puedes quitar al único owner' })
    }

    // Remove only the Mission Control membership — the Supabase Auth user is left
    // intact (they simply lose operator access). RLS for non-members denies all.
    const { error } = await supabaseAdmin.from('members').delete().eq('user_id', userId)
    if (error) return res.status(500).json({ error: error.message })
    await audit('control:member-remove', {
      actor: me.user_id, actor_email: me.email, target_type: 'member', target_id: userId,
      payload: { email: target.email, role: target.role },
    })
    return res.status(200).json({ ok: true, op, user_id: userId })
  }

  return res.status(400).json({ error: `op desconocida: ${op}` })
}
