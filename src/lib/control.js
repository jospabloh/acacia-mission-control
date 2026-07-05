import { supabase } from './supabase.js'

// Call a Mission Control `api/control/*` endpoint as the signed-in operator. The
// server validates the JWT and the member's role (admin+). Throws on error.
async function postControl(path, body) {
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) throw new Error('sesión no iniciada')
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${session.access_token}` },
    body: JSON.stringify(body),
  })
  const json = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(json.error || `error ${res.status}`)
  return json
}

// Trigger an on-demand sync of one app's licenses and/or usage.
export function runSync(appId, kinds = ['licenses', 'usage']) {
  return postControl('/api/control/run-sync', { appId, kinds })
}

// Read follow-up email history for one tenant (read-only; no email is sent).
export function emailStatus(appId, tenantExternalId) {
  return postControl('/api/control/email-status', { appId, tenantExternalId })
}

// WRITE: change a tenant's license (reactivate | suspend | view_only | set_plan |
// confirm_payment). For confirm_payment, opts carries { periodMonths, paymentReference }.
export function licenseAction(appId, licenseExternalId, op, plan, opts = {}) {
  return postControl('/api/control/license-action', { appId, licenseExternalId, op, plan, ...opts })
}

// Read tenant recipient contacts for an app (for targeting comunicados).
export function listContacts(appId) {
  return postControl('/api/control/list-contacts', { appId })
}

// Send a comunicado (renewal | campaign | maintenance) to recipients. Customer-facing.
export function sendMessage(payload) {
  return postControl('/api/control/send-message', payload)
}

// Aggregated first-party web KPIs per path (Freeware/Sitios). Read-only.
export function webKpis() {
  return postControl('/api/web-kpis', {})
}

// Per-tenant consumption for one app (counts only). Read-only.
export function usageByTenant(appId) {
  return postControl('/api/control/usage-by-tenant', { appId })
}

// Read one ticket's conversation thread (uniform shape). Read-only.
export function ticketThread(appId, ticketExternalId) {
  return postControl('/api/control/tickets', { appId, ticketExternalId, op: 'thread' })
}

// WRITE: reply to a ticket (op:'reply', body) or change its status (op:'status', status).
export function ticketAction(appId, ticketExternalId, op, extra = {}) {
  return postControl('/api/control/tickets', { appId, ticketExternalId, op, ...extra })
}

// ── Members (F8 Ajustes) — owner-only. All four go through one server endpoint
// so invites (which create a Supabase Auth user) and every change are audited. ──
export function listMembers() {
  return postControl('/api/control/members', { op: 'list' })
}
export function inviteMember(email, role) {
  return postControl('/api/control/members', { op: 'invite', email, role })
}
export function setMemberRole(userId, role) {
  return postControl('/api/control/members', { op: 'set-role', userId, role })
}
export function removeMember(userId) {
  return postControl('/api/control/members', { op: 'remove', userId })
}

// ── Sesiones activas ─────────────────────────────────────────────────────────
// Live per-user session list for one app (read-only). Returns
// { totals:{open,online,idle}, users:[{user_email,user_name,online,idle,sessions:[…]}] }.
export function appSessions(appId) {
  return postControl('/api/control/sessions', { appId })
}

// WRITE: force-logout sessions. scope:'session' revokes ids (an ACTIVE session
// needs opts.override AND owner role — otherwise the server replies 409 with
// { blocked }). scope:'user-idle' revokes all of userEmail's idle sessions and
// skips the active ones (reported as skipped_active).
export function revokeSessions(appId, { scope = 'session', ids, userEmail, override } = {}) {
  return postControl('/api/control/session-revoke', { appId, scope, ids, userEmail, override })
}
