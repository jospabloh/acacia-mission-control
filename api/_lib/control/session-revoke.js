// Control action (WRITE): force-logout end-user sessions of an app via the
// acaciaControl `sessions.revoke` bridge. THE 30-MIN RULE IS ENFORCED HERE,
// server-side — never trust the client. Reads the sessions LIVE first so idle is
// computed from the app's real last_active_at, applies the rule, revokes, audits
// and re-syncs the bodega. Admin-gated; forcing an ACTIVE session needs owner.
//
// POST { appId, scope: 'session' | 'user-idle' | 'user-all', ids?, userEmail?, override? }
//   - scope 'session'   → revoke the given session ids. Active (<30min idle) ones
//                          are blocked unless override && role==='owner'. If any
//                          requested id is blocked, nothing is revoked (409).
//   - scope 'user-idle' → revoke ALL of userEmail's idle sessions, skip the
//                          active ones (reported as skipped_active).
//   - scope 'user-all'  → "log off user": revoke EVERY session of userEmail,
//                          idle AND active — the one place the active-session
//                          protection is bypassed in full, not just for one id.
//                          owner-only, requires override:true.
import { supabaseAdmin, requireSupabase, audit } from '../supabaseAdmin.js'
import { callBridge, bridgeConfigured } from '../appBridge.js'
import { requireMember } from '../requireMember.js'
import { syncSessionsForApp } from '../sync/syncSessions.js'
import { normalizeOpenSessions, canRevoke, partitionForBulk, idsForUserAll } from '../sessions.js'

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method not allowed' })
  if (!requireSupabase(res)) return
  const member = await requireMember(req, res, 'admin')
  if (!member) return

  const { appId, scope = 'session', ids, userEmail, override } = req.body ?? {}
  if (!appId) return res.status(400).json({ error: 'falta appId' })
  if (!bridgeConfigured()) return res.status(503).json({ error: 'INGEST_HMAC_SECRET no configurado' })

  const { data: app, error } = await supabaseAdmin.from('apps').select('*').eq('id', appId).maybeSingle()
  if (error) return res.status(500).json({ error: error.message })
  if (!app) return res.status(404).json({ error: 'app no encontrada' })
  const entity = app.config?.session_entity
  if (!entity) return res.status(400).json({ error: 'esta app no reporta sesiones' })

  // Read the current sessions LIVE so the rule uses the app's real last_active_at.
  let listed
  try {
    listed = await callBridge(app, 'sessions.list', { entity })
  } catch (e) {
    return res.status(502).json({ error: `no se pudo leer las sesiones: ${e.message}` })
  }
  const now = Date.now()
  const sessions = normalizeOpenSessions(listed?.records ?? listed?.data?.records ?? [], now)
  const byId = new Map(sessions.map((s) => [s.external_id, s]))

  // Decide which ids to revoke, enforcing the rule.
  let toRevoke = []
  let skippedActive = 0
  if (scope === 'user-idle') {
    if (!userEmail) return res.status(400).json({ error: 'falta userEmail' })
    const userSessions = sessions.filter((s) => s.user_email === userEmail)
    const part = partitionForBulk(userSessions)
    toRevoke = part.closableIds
    skippedActive = part.skippedActive
  } else if (scope === 'user-all') {
    if (!userEmail) return res.status(400).json({ error: 'falta userEmail' })
    if (member.role !== 'owner') return res.status(403).json({ error: 'solo el owner puede forzar el cierre de todas las sesiones' })
    if (!override) return res.status(400).json({ error: 'confirma el forzado (override) para cerrar sesiones activas' })
    toRevoke = idsForUserAll(sessions, userEmail)
  } else {
    if (!Array.isArray(ids) || ids.length === 0) return res.status(400).json({ error: 'falta ids' })
    const blocked = []
    for (const id of ids) {
      const s = byId.get(String(id))
      if (!s) continue // already gone / revoked — nothing to do
      const verdict = canRevoke(s, { role: member.role, override: !!override })
      if (verdict.ok) toRevoke.push(s.external_id)
      else blocked.push({ id: s.external_id, user_email: s.user_email, device: s.device, idle_ms: s.idle_ms, reason: verdict.reason })
    }
    // Atomic UX: if the operator asked to close something they can't, revoke
    // nothing and tell them why (the UI shows the warning, not a red error).
    if (blocked.length) return res.status(409).json({ error: 'sesión(es) activa(s) protegida(s)', blocked })
  }

  // Nothing eligible (e.g. bulk on a user with only active sessions): no-op OK.
  if (toRevoke.length === 0) {
    return res.status(200).json({ ok: true, revoked: 0, skipped_active: skippedActive })
  }

  try {
    await callBridge(app, 'sessions.revoke', { entity, ids: toRevoke, actorEmail: member.email })
  } catch (e) {
    return res.status(502).json({ error: e.message })
  }

  // Reflect the revoke in the bodega right away (best-effort).
  let resync = null
  try { resync = await syncSessionsForApp(app) } catch (e) { resync = { error: e.message } }

  await audit('control:session-revoke', {
    actor: member.user_id, actor_email: member.email, target_app: appId,
    payload: { scope, ids: toRevoke, userEmail: userEmail ?? null, override: !!override, forced: (scope === 'session' || scope === 'user-all') && !!override, skipped_active: skippedActive },
  })

  return res.status(200).json({ ok: true, revoked: toRevoke.length, skipped_active: skippedActive, resync })
}
